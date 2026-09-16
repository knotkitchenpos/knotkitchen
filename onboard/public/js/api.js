const API_BASE = '/api';

// Any authenticated call that comes back 401 means the session cookie is
// missing/expired. Drop the stale client-side session so the next render
// shows the login screen.
//
// It deliberately does NOT reload the page. It used to, and that reload was
// what made an expired session look like "the Submit button does nothing":
// the POST 401'd, the page reloaded out from under the agent, and the whole
// form was gone with no message. loadSession() now checks the session up
// front, so an expired one is caught before any work is done.
async function handleAuthedResponse(res) {
  if (res.status === 401) {
    try { localStorage.removeItem('kk_user_session_v6'); } catch (e) {}
    return { success: false, sessionExpired: true, message: 'Your session has expired.' };
  }
  return res.json();
}

/**
 * Same as handleAuthedResponse, but reports a dead session instead of acting
 * on it. Used by saves: a reload mid-submit throws away the agent's form and
 * tells them nothing, so the caller decides what to do.
 */
async function handleSaveResponse(res) {
  if (res.status === 401) {
    return { success: false, sessionExpired: true, message: 'Your session has expired.' };
  }
  try {
    return await res.json();
  } catch (e) {
    return { success: false, message: 'Server returned an unreadable response (HTTP ' + res.status + ').' };
  }
}

const apiClient = {
  /**
   * Ask the SERVER who we are. The client caches the signed-in agent in
   * localStorage, which never expires, while the session cookie is only good
   * for 12h — so without this the portal shows a logged-in wizard whose every
   * request is already 401ing. Deliberately does NOT reload on 401; the caller
   * is usually deciding whether to show the login screen in the first place.
   */
  me: async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`);
      if (!res.ok) return { success: false };
      return await res.json();
    } catch (e) {
      return { success: false, offline: true };
    }
  },

  login: async (username, password) => {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      return await res.json();
    } catch (e) {
      console.error('API login error:', e);
      return { success: false, message: 'Server connection error' };
    }
  },

  logout: async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
      return await res.json();
    } catch (e) {
      return { success: false };
    }
  },

  getAgents: async () => {
    try {
      const res = await fetch(`${API_BASE}/agents`);
      return await handleAuthedResponse(res);
    } catch (e) {
      return { success: false, agents: [] };
    }
  },

  addAgent: async (agentData) => {
    try {
      const res = await fetch(`${API_BASE}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData)
      });
      return await handleAuthedResponse(res);
    } catch (e) {
      return { success: false, message: 'Failed to add agent' };
    }
  },

  updateAgent: async (username, agentData) => {
    try {
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(username)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData)
      });
      return await handleAuthedResponse(res);
    } catch (e) {
      return { success: false, message: 'Failed to update agent' };
    }
  },

  toggleAgent: async (username) => {
    try {
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(username)}/toggle`, {
        method: 'PATCH'
      });
      return await handleAuthedResponse(res);
    } catch (e) {
      return { success: false, message: 'Failed to toggle agent' };
    }
  },

  deleteAgent: async (username) => {
    try {
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(username)}`, {
        method: 'DELETE'
      });
      return await handleAuthedResponse(res);
    } catch (e) {
      return { success: false, message: 'Failed to delete agent' };
    }
  },

  getNextAgreementId: async () => {
    try {
      const res = await fetch(`${API_BASE}/agreements/next-id`, { method: 'POST' });
      return await res.json();
    } catch (e) {
      const now = new Date();
      const dateStr = now.getFullYear().toString() + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0');
      return { success: true, agreementId: `KK-AGR-${dateStr}-1001` };
    }
  },

  getAgreements: async () => {
    try {
      const res = await fetch(`${API_BASE}/agreements`);
      return await handleAuthedResponse(res);
    } catch (e) {
      return { success: false, agreements: {} };
    }
  },

  getAgreementById: async (id) => {
    try {
      const res = await fetch(`${API_BASE}/agreements/${encodeURIComponent(id)}`);
      return await handleAuthedResponse(res);
    } catch (e) {
      return { success: false, message: 'Agreement not found' };
    }
  },

  saveAgreement: async (agreementData) => {
    try {
      const res = await fetch(`${API_BASE}/agreements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agreementData)
      });
      return await handleSaveResponse(res);
    } catch (e) {
      return { success: false, message: 'Could not reach the server.' };
    }
  },

  deleteAgreement: async (id) => {
    try {
      const res = await fetch(`${API_BASE}/agreements/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      return await handleAuthedResponse(res);
    } catch (e) {
      return { success: false, message: 'Failed to delete agreement' };
    }
  },

  deleteAgreementDocument: async (id, fileKey) => {
    try {
      const res = await fetch(`${API_BASE}/agreements/${encodeURIComponent(id)}/files/${encodeURIComponent(fileKey)}`, {
        method: 'DELETE'
      });
      return await handleAuthedResponse(res);
    } catch (e) {
      return { success: false, message: 'Failed to delete document' };
    }
  }
};
