import { readFileSync, writeFileSync } from 'fs';

// Target version: CLI arg (PR-based release flow) or npm_package_version (`npm version`).
const argVersion = process.argv[2];
const targetVersion = argVersion ?? process.env.npm_package_version;

if (!targetVersion) {
	console.error('No target version. Usage: node version-bump.mjs <version>');
	process.exit(1);
}

// With a CLI arg, npm has not bumped package.json — do it here.
if (argVersion) {
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	pkg.version = targetVersion;
	writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n');
}

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t'));

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));
