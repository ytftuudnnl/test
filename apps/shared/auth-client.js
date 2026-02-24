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

  function makeClientError(code, message) {
    var err = new Error(message);
    err.code = code;
    err.status = 0;
    return err;
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
      var error = new Error((payload && payload.message) || ("HTTP " + response.status));
      error.status = response.status;
      error.code = payload && payload.code;
      error.traceId = payload && payload.traceId;
      error.payload = payload;
      throw error;
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
  };
})();
