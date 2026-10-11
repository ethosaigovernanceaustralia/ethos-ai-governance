'use strict';

// Return names only. Never include configured values in errors or logs.
function missingEnvironment(names, env = process.env) {
  return names.filter(name => typeof env[name] !== 'string' || !env[name].trim());
}

module.exports = { missingEnvironment };
