(function initCbspAuthClient() {
  var STORAGE_KEY = "cbsp.session.v1";
  var API_BASE = (window.CBSP_API_BASE || "http://localhost:3100").replace(/\/+$/, "");
  var REQUEST_TIMEOUT_MS = Number(window.CBSP_REQUEST_TIMEOUT_MS || 10000);
  var refreshInFlight = null;
  var session = loadSession();

  function loadSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.token || !parsed.refreshToken) return null;
      return parsed;
    } catch (_err) {
      return null;
    }
  }

  function saveSession(next) {
    session = next;
    if (!next) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function decodeBase64Url(value) {
    var normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    var pad = normalized.length % 4;
    if (pad) normalized += "=".repeat(4 - pad);
    return atob(normalized);
  }

  function parseJwtClaims(token) {
    try {
      var parts = String(token || "").split(".");
      if (parts.length !== 3) return null;
      return JSON.parse(decodeBase64Url(parts[1]));
    } catch (_err) {
      return null;
    }
  }

  function getRoleFromSession(current) {
    if (!current) return null;
    if (current.user && typeof current.user.role === "string") return current.user.role;
    var claims = parseJwtClaims(current.token);
    if (claims && typeof claims.role === "string") return claims.role;
    return null;
  }

  function isIsoExpired(isoText) {
    if (!isoText) return false;
    var ts = Date.parse(isoText);
    if (!Number.isFinite(ts)) return false;
    return Date.now() + 5000 >= ts;
  }

  function buildError(fields) {
    var message = fields && fields.message ? String(fields.message) : "Request failed";
    var err = new Error(message);
    err.name = "CbspClientError";
    err.status = fields && Number.isFinite(fields.status) ? fields.status : 0;
    err.code = fields && fields.code ? String(fields.code) : "UNKNOWN_ERROR";
    err.traceId = fields && fields.traceId ? String(fields.traceId) : null;
    if (fields && fields.details !== undefined) err.details = fields.details;
    if (fields && fields.payload !== undefined) err.payload = fields.payload;
    if (fields && fields.kind) err.kind = String(fields.kind);
    return err;
  }

  function makeClientError(code, message, details) {
    return buildError({
      status: 0,
      code: code || "CLIENT_ERROR",
      message: message || "Client error",
      traceId: null,
      details: details,
      kind: "client",
    });
  }

  function normalizeError(error) {
    if (error && typeof error === "object") {
      var statusNum = Number(error.status);
      return {
        status: Number.isFinite(statusNum) ? statusNum : 0,
        code: typeof error.code === "string" && error.code ? error.code : "UNKNOWN_ERROR",
        message: typeof error.message === "string" && error.message ? error.message : "Request failed",
        traceId: typeof error.traceId === "string" && error.traceId ? error.traceId : null,
        details: Object.prototype.hasOwnProperty.call(error, "details") ? error.details : undefined,
      };
    }
    return {
      status: 0,
      code: "UNKNOWN_ERROR",
      message: typeof error === "string" && error ? error : "Request failed",
      traceId: null,
      details: undefined,
    };
  }

  function formatError(error) {
    var normalized = normalizeError(error);
    var parts = [normalized.message];
    if (normalized.code && normalized.code !== "UNKNOWN_ERROR") {
      parts.push("[" + normalized.code + "]");
    }
    if (normalized.traceId) {
      parts.push("(traceId=" + normalized.traceId + ")");
    }
    return parts.join(" ");
  }

  async function refreshSession() {
    if (!session || !session.refreshToken) {
      throw makeClientError("AUTH_REFRESH_MISSING", "Missing refresh token");
    }
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async function runRefresh() {
      var payload = await requestJson("/api/auth/refresh", {
        method: "POST",
        body: { refreshToken: session.refreshToken },
        auth: false,
        retry: false,
      });
      if (!payload || !payload.data || !payload.data.token || !payload.data.refreshToken) {
        throw makeClientError("AUTH_REFRESH_INVALID", "Refresh response is invalid");
      }
      saveSession({
        token: payload.data.token,
        refreshToken: payload.data.refreshToken,
        tokenExpiresAt: payload.data.tokenExpiresAt,
        refreshTokenExpiresAt: payload.data.refreshTokenExpiresAt,
        user: session.user || null,
      });
      return session;
    })();

    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  async function requestJson(path, options) {
    var opts = options || {};
    var method = opts.method || "GET";
    var auth = opts.auth !== false;
    var retry = opts.retry !== false;
    var body = opts.body;
    var headers = { accept: "application/json" };
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutHandle = null;
    if (controller && Number.isFinite(REQUEST_TIMEOUT_MS) && REQUEST_TIMEOUT_MS > 0) {
      timeoutHandle = setTimeout(function () {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
    }

    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    if (auth) {
      if (!session || !session.token) {
        throw makeClientError("AUTH_REQUIRED", "Please login first");
      }
      if (isIsoExpired(session.tokenExpiresAt) && session.refreshToken) {
        try {
          await refreshSession();
        } catch (_err) {
          saveSession(null);
          throw makeClientError("AUTH_EXPIRED", "Session expired, please login again");
        }
      }
      if (session && session.token) {
        headers.authorization = "Bearer " + session.token;
      }
    }

    var response;
    try {
      response = await fetch(API_BASE + path, {
        method: method,
        headers: headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (error && error.name === "AbortError") {
        throw makeClientError("NETWORK_TIMEOUT", "Request timeout after " + REQUEST_TIMEOUT_MS + "ms");
      }
      throw makeClientError("NETWORK_ERROR", "Network request failed");
    }
    if (timeoutHandle) clearTimeout(timeoutHandle);

    var text = await response.text();
    var payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_err) {
        payload = { raw: text };
      }
    }

    if (response.status === 401 && auth && retry && session && session.refreshToken) {
      try {
        await refreshSession();
        return await requestJson(path, {
          method: method,
          body: body,
          auth: auth,
          retry: false,
        });
      } catch (_err2) {
        saveSession(null);
      }
    }

    if (!response.ok) {
      throw buildError({
        status: response.status,
        code: (payload && payload.code) || ("HTTP_" + response.status),
        message: (payload && payload.message) || ("HTTP " + response.status),
        traceId: (payload && payload.traceId) || null,
        details: payload && payload.details,
        payload: payload,
        kind: "api",
      });
    }

    return payload;
  }

  async function login(username, password) {
    var payload = await requestJson("/api/auth/login", {
      method: "POST",
      auth: false,
      retry: false,
      body: { username: username, password: password },
    });
    if (!payload || !payload.data || !payload.data.token || !payload.data.refreshToken) {
      throw makeClientError("AUTH_LOGIN_INVALID", "Login response is invalid");
    }
    saveSession({
      token: payload.data.token,
      refreshToken: payload.data.refreshToken,
      tokenExpiresAt: payload.data.tokenExpiresAt,
      refreshTokenExpiresAt: payload.data.refreshTokenExpiresAt,
      user: payload.data.user || null,
    });
    return session;
  }

  function logout() {
    saveSession(null);
  }

  window.CBSPAuth = {
    apiBase: API_BASE,
    getSession: function getSession() {
      return session;
    },
    getRole: function getRole() {
      return getRoleFromSession(session);
    },
    isLoggedIn: function isLoggedIn() {
      return Boolean(session && session.token);
    },
    login: login,
    logout: logout,
    refreshSession: refreshSession,
    fetchJson: requestJson,
    normalizeError: normalizeError,
    formatError: formatError,
  };
})();
