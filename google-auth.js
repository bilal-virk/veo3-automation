// google-auth.js
class GoogleServiceAccountAuth {
  constructor(credentials) {
    this.credentials = credentials;
    this.token = null;
    this.tokenExpiry = null;
  }

  async getAccessToken() {
    // Check if we have a valid cached token
    if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry - 60000) {
      return this.token;
    }

    console.log('[AUTH] Generating new access token...');

    // Create JWT
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600; // 1 hour

    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };

    const claimSet = {
      iss: this.credentials.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: expiry,
      iat: now
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedClaimSet = this.base64UrlEncode(JSON.stringify(claimSet));
    const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

    // Import private key
    const privateKey = await this.importPrivateKey(this.credentials.private_key);
    
    // Sign the JWT
    const signatureBuffer = await crypto.subtle.sign(
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: { name: 'SHA-256' }
      },
      privateKey,
      new TextEncoder().encode(signatureInput)
    );

    const signature = this.base64UrlEncode(signatureBuffer);
    const jwt = `${signatureInput}.${signature}`;

    // Exchange JWT for access token
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AUTH] Token exchange failed:', errorText);
      throw new Error(`Failed to get access token: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    this.token = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);

    console.log('[AUTH] ✅ Access token obtained');
    return this.token;
  }

  async importPrivateKey(pemKey) {
    // Remove PEM header/footer and newlines
    const pemContents = pemKey
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s/g, '');

    // Convert base64 to binary
    const binaryDer = this.base64Decode(pemContents);

    // Import the key
    return await crypto.subtle.importKey(
      'pkcs8',
      binaryDer,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: { name: 'SHA-256' }
      },
      false,
      ['sign']
    );
  }

  base64Decode(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  base64UrlEncode(data) {
    let base64;
    if (typeof data === 'string') {
      base64 = btoa(data);
    } else if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64 = btoa(binary);
    } else {
      throw new Error('Unsupported data type for base64UrlEncode');
    }

    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}

class GoogleSheetsAPI {
  constructor(auth) {
    this.auth = auth;
    this.baseUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
  }

  async getValues(spreadsheetId, range) {
    const token = await this.auth.getAccessToken();
    
    const url = `${this.baseUrl}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SHEETS] GET failed:', errorText);
      throw new Error(`Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.`);
    }

    const data = await response.json();
    return data.values || [];
  }

  async updateValues(spreadsheetId, range, values) {
    const token = await this.auth.getAccessToken();
    
    const url = `${this.baseUrl}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: values
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SHEETS] UPDATE failed:', errorText);
      throw new Error(`Failed to update values: ${response.status}`);
    }

    return await response.json();
  }

  async getSpreadsheet(spreadsheetId) {
    const token = await this.auth.getAccessToken();
    
    const url = `${this.baseUrl}/${spreadsheetId}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SHEETS] GET SPREADSHEET failed:', errorText);
      throw new Error(`Cannot access spreadsheet: ${response.status}`);
    }

    return await response.json();
  }

  async batchUpdate(spreadsheetId, requests) {
    const token = await this.auth.getAccessToken();
    
    const url = `${this.baseUrl}/${spreadsheetId}:batchUpdate`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: requests
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SHEETS] BATCH UPDATE failed:', errorText);
      throw new Error(`Failed to batch update: ${response.status}`);
    }

    return await response.json();
  }
}