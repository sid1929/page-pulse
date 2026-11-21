
'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

// Convert IPv4 address to an integer.
function ipv4ToBigInt(ip) {
  const parts = ip.split('.').map(Number);

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }

  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

// Convert IPv6 address to an integer.
function ipv6ToBigInt(ip) {
  let address = ip.toLowerCase().split('%')[0];

  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    const ipv4 = ipv4ToBigInt(address.slice(lastColon + 1));

    if (ipv4 === null) return null;

    const high = Number((ipv4 >> 16n) & 0xffffn);
    const low = Number(ipv4 & 0xffffn);

    address = `${address.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = address.split('::');

  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  const missing = 8 - left.length - right.length;

  if ((halves.length === 1 && missing !== 0) ||
      (halves.length === 2 && missing < 1)) {
    return null;
  }

  const groups = [...left, ...Array(missing).fill('0'), ...right];

  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) {
    return null;
  }

  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(parseInt(group, 16)),
    0n
  );
}

function inCidr(address, base, bits, width) {
  const shift = BigInt(width - bits);
  return (address >> shift) === (base >> shift);
}

const IPV4_BLOCKED = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].map(([ip, bits]) => [ipv4ToBigInt(ip), bits]);

const IPV6_BLOCKED = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
].map(([ip, bits]) => [ipv6ToBigInt(ip), bits]);

function isPublicIp(ip) {
  const family = net.isIP(ip);

  if (family === 4) {
    const value = ipv4ToBigInt(ip);

    if (value === null) return false;

    return !IPV4_BLOCKED.some(([base, bits]) =>
      inCidr(value, base, bits, 32)
    );
  }

  if (family === 6) {
    const value = ipv6ToBigInt(ip);

    if (value === null) return false;

    // Only accept IPv6 global unicast space.
    if (!inCidr(value, ipv6ToBigInt('2000::'), 3, 128)) {
      return false;
    }

    return !IPV6_BLOCKED.some(([base, bits]) =>
      inCidr(value, base, bits, 128)
    );
  }

  return false;
}
function isExpectedSocketIp(remoteAddress, expectedAddress) {
  if (
    typeof remoteAddress !== 'string' ||
    typeof expectedAddress !== 'string'
  ) {
    return false;
  }

  const normalize = (ip) =>
    ip.replace(/^::ffff:/i, '').toLowerCase();

  const remote = normalize(remoteAddress);
  const expected = normalize(expectedAddress);

  return isPublicIp(remote) && remote === expected;
}


async function resolvePublicAddress(hostname, {
  lookup = dns.lookup,
} = {}) {
  const literalFamily = net.isIP(hostname);

  if (literalFamily) {
    if (!isPublicIp(hostname)) {
      throw new Error('Target IP address is not publicly routable');
    }

    return { address: hostname, family: literalFamily };
  }

  const answers = await lookup(hostname, {
    all: true,
    verbatim: true,
  });

  if (!answers.length) {
    throw new Error('Hostname did not resolve');
  }

  if (answers.some((answer) => !isPublicIp(answer.address))) {
    throw new Error('Hostname resolves to an unsafe IP address');
  }

  return answers[0];
}


function readResponseBody(res, req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const contentLength = res.headers['content-length'];

    if (contentLength !== undefined) {
      const declaredBytes = Number(contentLength);

      if (
        !Number.isSafeInteger(declaredBytes) ||
        declaredBytes < 0 ||
        declaredBytes > maxBytes
      ) {
        const error = new Error(
          'Upstream response exceeds size limit'
        );

        fail(error);
        req.destroy(error);
        return;
      }
    }

    res.on('data', (chunk) => {
      if (settled) return;

      totalBytes += chunk.length;

      if (totalBytes > maxBytes) {
        const error = new Error(
          'Upstream response exceeds size limit'
        );

        fail(error);
        req.destroy(error);
        return;
      }

      chunks.push(chunk);
    });

    res.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });

    res.on('aborted', () => {
      fail(new Error('Upstream response was interrupted'));
    });

    res.on('error', fail);
  });
}
function getTlsInfo(socket) {
  if (!socket || typeof socket.getPeerCertificate !== 'function') {
    return null;
  }

  const certificate = socket.getPeerCertificate();

  return {
    protocol: socket.getProtocol(),
    authorized: socket.authorized,
    authorizationError: socket.authorizationError || null,
    certificate: {
      subject: certificate.subject || null,
      issuer: certificate.issuer || null,
      validFrom: certificate.valid_from || null,
      validTo: certificate.valid_to || null,
      fingerprint256: certificate.fingerprint256 || null,
    },
  };
}


function requestOnce(url, address, options) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;

    const requestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        'User-Agent': 'PagePulse-Audit/1.0',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      agent: false,
      rejectUnauthorized: true,

      // Pin the connection to the previously validated IP.
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions && lookupOptions.all) {
          callback(null, [
            {
              address: address.address,
              family: address.family,
            },
          ]);
          return;
        }

        callback(null, address.address, address.family);
      },
    };

    // Preserve the original hostname for TLS SNI.
    if (url.protocol === 'https:' && net.isIP(url.hostname) === 0) {
      requestOptions.servername = url.hostname;
    }

    let req;
    let socketVerified = false;

    const verifySocket = (socket) => {
      if (socketVerified) return;
      socketVerified = true;

      const remoteAddress = socket.remoteAddress;

      if (!remoteAddress) {
        req.destroy(
          new Error('Unable to verify upstream socket address')
        );
        return;
      }

      if (!isExpectedSocketIp(remoteAddress, address.address)) {
        req.destroy(
          new Error('Upstream socket IP does not match validated address')
        );
      }
    };

    req = transport.request(requestOptions, (res) => {
  const tlsInfo = url.protocol === 'https:'
  ? getTlsInfo(res.socket)
  : null;

  readResponseBody(res, req, options.maxBytes)
    .then((body) => {
      resolve({
        status: res.statusCode,
        headers: res.headers,
        body,
        tls: tlsInfo,
      });
    })
    .catch(reject);
});
    req.on('socket', (socket) => {
      if (socket.connecting) {
        socket.once('connect', () => verifySocket(socket));
      } else {
        verifySocket(socket);
      }
    });

    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error('Upstream request timed out'));
    });

    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy(new Error('Request aborted'));
      } else {
        options.signal.addEventListener(
          'abort',
          () => req.destroy(new Error('Request aborted')),
          { once: true }
        );
      }
    }

    req.on('error', reject);
    req.end();
  });
}



async function requestPinned(rawUrl, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  maxRedirects = MAX_REDIRECTS,
  signal,
  lookup = dns.lookup,
  request = requestOnce,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  const requestController = new AbortController();

  let timeoutId;
  let externalAbortHandler;

  const deadlinePromise = new Promise((_, reject) => {
  timeoutId = setTimeout(() => {
    reject(new Error('Total request deadline exceeded'));
    requestController.abort();
  }, timeoutMs);
});

  const getRemainingTime = () => {
    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      throw new Error('Total request deadline exceeded');
    }

    return remaining;
  };

  if (signal) {
    externalAbortHandler = () => requestController.abort();

    if (signal.aborted) {
      requestController.abort();
    } else {
      signal.addEventListener('abort', externalAbortHandler, {
        once: true,
      });
    }
  }

  try {
    let currentUrl = new URL(rawUrl);
    let redirected = false;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (requestController.signal.aborted) {
        throw new Error('Request aborted');
      }

      if (!['http:', 'https:'].includes(currentUrl.protocol)) {
        throw new Error('Only HTTP and HTTPS are allowed');
      }

      if (currentUrl.username || currentUrl.password) {
        throw new Error('URLs containing credentials are not allowed');
      }

      getRemainingTime();

      const address = await Promise.race([
        resolvePublicAddress(currentUrl.hostname, { lookup }),
        deadlinePromise,
      ]);

      const remainingBeforeRequest = getRemainingTime();

      const response = await Promise.race([
        request(currentUrl, address, {
          timeoutMs: remainingBeforeRequest,
          maxBytes,
          signal: requestController.signal,
        }),
        deadlinePromise,
      ]);

      const status = response.status;
      const location = response.headers.location;

      if ([301, 302, 303, 307, 308].includes(status) && location) {
        if (hop === maxRedirects) {
          throw new Error('Maximum redirect count exceeded');
        }

        const nextUrl = new URL(location, currentUrl);

        if (
          currentUrl.protocol === 'https:' &&
          nextUrl.protocol === 'http:'
        ) {
          throw new Error('HTTPS to HTTP redirect is not allowed');
        }

        currentUrl = nextUrl;
        redirected = true;
        continue;
      }

            return {
        status,
        ok: status >= 200 && status < 300,
        redirected,
        url: currentUrl.toString(),
        headers: response.headers,
        body: response.body,
        tls: response.tls || null,
      };
    }

    throw new Error('Maximum redirect count exceeded');
  } finally {
    clearTimeout(timeoutId);

    if (signal && externalAbortHandler) {
      signal.removeEventListener('abort', externalAbortHandler);
    }
  }
}


module.exports = {
  requestPinned,
  isPublicIp,
  resolvePublicAddress,
  isExpectedSocketIp,
  requestOnce,
  readResponseBody,
  getTlsInfo,
};
