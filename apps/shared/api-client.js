(function initCbspApiClient() {
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

  function ensureObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw buildError({
        status: 0,
        code: "CLIENT_PAYLOAD_INVALID",
        message: label + " must be an object",
        traceId: null,
        details: { label: label, actualType: Array.isArray(value) ? "array" : typeof value },
        kind: "contract",
      });
    }
    return value;
  }

  function ensureArray(value, label) {
    if (!Array.isArray(value)) {
      throw buildError({
        status: 0,
        code: "CLIENT_PAYLOAD_INVALID",
        message: label + " must be an array",
        traceId: null,
        details: { label: label, actualType: typeof value },
        kind: "contract",
      });
    }
    return value;
  }

  function toQuery(params) {
    if (!params) return "";
    var entries = Object.entries(params).filter(function (entry) {
      return entry[1] !== undefined && entry[1] !== null && entry[1] !== "";
    });
    if (!entries.length) return "";
    var query = entries
      .map(function (entry) {
        return encodeURIComponent(entry[0]) + "=" + encodeURIComponent(String(entry[1]));
      })
      .join("&");
    return query ? "?" + query : "";
  }

  function unwrapData(payload, label) {
    var obj = ensureObject(payload, label + " payload");
    if (!Object.prototype.hasOwnProperty.call(obj, "data")) {
      throw buildError({
        status: 0,
        code: "CLIENT_PAYLOAD_INVALID",
        message: label + " payload missing data field",
        traceId: null,
        details: { label: label },
        kind: "contract",
      });
    }
    return obj.data;
  }

  /**
   * @param {{ apiBase: string, fetchJson: (path: string, options?: any) => Promise<any> }} auth
   */
  function create(auth) {
    if (!auth || typeof auth.fetchJson !== "function") {
      throw buildError({
        status: 0,
        code: "CLIENT_INIT_INVALID",
        message: "CBSPApiClient.create requires a valid auth client",
        traceId: null,
        kind: "client",
      });
    }

    function normalizeWithAuth(error) {
      if (typeof auth.normalizeError === "function") return auth.normalizeError(error);
      return normalizeError(error);
    }

    function formatWithAuth(error) {
      if (typeof auth.formatError === "function") return auth.formatError(error);
      return formatError(error);
    }

    async function get(path) {
      return auth.fetchJson(path);
    }

    async function post(path, body) {
      return auth.fetchJson(path, { method: "POST", body: body });
    }

    async function del(path) {
      return auth.fetchJson(path, { method: "DELETE" });
    }

    return {
      normalizeError: normalizeWithAuth,
      formatError: formatWithAuth,

      async health() {
        var data = unwrapData(await auth.fetchJson("/health", { auth: false, retry: false }), "health");
        return ensureObject(data, "health data");
      },

      async listMessages(params) {
        var data = unwrapData(await get("/api/messages" + toQuery(params)), "messages");
        var list = ensureObject(data, "messages data");
        list.items = ensureArray(list.items || [], "messages.items");
        return list;
      },

      async listCustomers(params) {
        var data = unwrapData(await get("/api/customers" + toQuery(params)), "customers");
        var list = ensureObject(data, "customers data");
        list.items = ensureArray(list.items || [], "customers.items");
        return list;
      },

      async listAutomations(params) {
        var data = unwrapData(await get("/api/automations" + toQuery(params)), "automations");
        var list = ensureObject(data, "automations data");
        list.items = ensureArray(list.items || [], "automations.items");
        return list;
      },

      async listIntegrations() {
        var data = unwrapData(await get("/api/integrations"), "integrations");
        return ensureArray(data || [], "integrations data");
      },

      async getAnalyticsSummary() {
        var data = unwrapData(await get("/api/analytics/summary"), "analytics.summary");
        return ensureObject(data, "analytics.summary data");
      },

      async listChannels() {
        var data = unwrapData(await get("/api/channels"), "channels");
        return ensureArray(data || [], "channels data");
      },

      async createChannel(input) {
        var data = unwrapData(await post("/api/channels", input), "channels.create");
        return ensureObject(data, "channels.create data");
      },

      async deleteChannel(id) {
        var encodedId = encodeURIComponent(String(id));
        var data = unwrapData(await del("/api/channels/" + encodedId), "channels.delete");
        return ensureObject(data, "channels.delete data");
      },
    };
  }

  window.CBSPApiClient = {
    create: create,
  };
})();
