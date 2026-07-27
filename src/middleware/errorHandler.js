'use strict';

/**
 * Converts any thrown error into the service's single structured error
 * shape, so every client — script or human — parses errors one way.
 */
function toErrorResponse(err, requestId) {
  const statusCode = err.statusCode || 500;
  const code = err.name || 'InternalError';
  const message = statusCode >= 500 ? 'An unexpected error occurred' : err.message;

  return {
    statusCode,
    body: {
      error: {
        code,
        message,
        requestId,
      },
    },
  };
}

module.exports = { toErrorResponse };
