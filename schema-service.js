(function (global) {
  "use strict";

  function requireFunction(value, name) {
    if (typeof value !== "function") {
      throw new TypeError(`${name} must be a function`);
    }
    return value;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function create(options = {}) {
    const currentVersion = Number(options.currentVersion);
    const legacyVersion = Number(options.legacyVersion || 1);
    const normalizeData = requireFunction(options.normalizeData, "normalizeData");
    const migrations = options.migrations || {};

    if (!Number.isInteger(currentVersion) || currentVersion < 1) {
      throw new Error("currentVersion must be a positive integer");
    }

    if (!Number.isInteger(legacyVersion) || legacyVersion < 1) {
      throw new Error("legacyVersion must be a positive integer");
    }

    function detectVersion(source) {
      const detected = Number(source?.schemaVersion);
      if (Number.isInteger(detected) && detected >= 1) return detected;
      return legacyVersion;
    }

    function normalizeCurrent(source) {
      return normalizeData(source, {
        currentVersion,
        sourceVersion: detectVersion(source)
      });
    }

    function prepare(source) {
      const original = source && typeof source === "object" ? source : {};
      const sourceVersion = detectVersion(original);

      if (sourceVersion > currentVersion) {
        const error = new Error(
          `This data uses schema version ${sourceVersion}, but this app supports up to version ${currentVersion}.`
        );
        error.code = "UNSUPPORTED_FUTURE_SCHEMA";
        error.sourceVersion = sourceVersion;
        error.currentVersion = currentVersion;
        throw error;
      }

      let working = cloneJson(original);
      let version = sourceVersion;
      const migratedAt = new Date().toISOString();
      const steps = [];

      while (version < currentVersion) {
        const migration = migrations[version];
        if (typeof migration !== "function") {
          const error = new Error(`Missing migration from schema version ${version}`);
          error.code = "MISSING_MIGRATION";
          error.sourceVersion = sourceVersion;
          error.currentVersion = currentVersion;
          throw error;
        }

        const nextVersion = version + 1;
        working = migration(working, {
          fromVersion: version,
          toVersion: nextVersion,
          currentVersion,
          migratedAt
        });

        if (!working || typeof working !== "object") {
          throw new Error(`Migration ${version} to ${nextVersion} returned invalid data`);
        }

        working.schemaVersion = nextVersion;
        steps.push({
          fromVersion: version,
          toVersion: nextVersion,
          migratedAt
        });
        version = nextVersion;
      }

      const data = normalizeData(working, {
        currentVersion,
        sourceVersion,
        migratedAt,
        steps
      });

      data.schemaVersion = currentVersion;

      return {
        data,
        report: {
          sourceVersion,
          currentVersion,
          didMigrate: steps.length > 0,
          migratedAt: steps.length ? migratedAt : "",
          steps
        }
      };
    }

    return Object.freeze({
      prepare,
      normalizeCurrent,
      detectVersion,
      getCurrentVersion: () => currentVersion,
      getLegacyVersion: () => legacyVersion
    });
  }

  global.PriceTrackerSchemaService = Object.freeze({ create });
})(window);
