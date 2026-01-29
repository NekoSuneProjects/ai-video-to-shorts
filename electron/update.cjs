const { app, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");

const DEFAULT_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Shorts-Lab-Updater"
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!res.ok) {
    throw new Error(`Update check failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function normalizeVersion(tag) {
  return String(tag || "").replace(/^v/i, "");
}

function compareSemver(a, b) {
  const pa = String(a).split(".").map((n) => Number(n) || 0);
  const pb = String(b).split(".").map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function pickRelease(releases, channel) {
  if (!Array.isArray(releases)) return null;
  if (channel === "beta") {
    return releases.find((r) => r.prerelease) || releases[0] || null;
  }
  return releases.find((r) => !r.prerelease) || null;
}

function pickAsset(assets) {
  if (!Array.isArray(assets)) return null;
  const platform = process.platform;
  const arch = process.arch;

  const has = (name, patterns) => patterns.some((p) => p.test(name));
  const byExt = (exts) => assets.filter((a) => exts.some((e) => a.name.endsWith(e)));

  if (platform === "win32") {
    const exes = byExt([".exe"]);
    const msis = byExt([".msi"]);
    if (arch === "arm64") {
      return (
        exes.find((a) => has(a.name.toLowerCase(), [/arm64/, /aarch64/])) ||
        msis.find((a) => has(a.name.toLowerCase(), [/arm64/, /aarch64/])) ||
        exes[0]
      );
    }
    return (
      exes.find((a) => has(a.name.toLowerCase(), [/x64/, /amd64/, /win64/])) ||
      msis.find((a) => has(a.name.toLowerCase(), [/x64/, /amd64/, /win64/])) ||
      exes[0]
    );
  }

  if (platform === "darwin") {
    const dmgs = byExt([".dmg"]);
    if (arch === "arm64") {
      return (
        dmgs.find((a) => has(a.name.toLowerCase(), [/arm64/, /aarch64/])) ||
        dmgs[0]
      );
    }
    return (
      dmgs.find((a) => has(a.name.toLowerCase(), [/x64/, /amd64/, /intel/])) ||
      dmgs[0]
    );
  }

  const appImages = byExt([".AppImage"]);
  const debs = byExt([".deb"]);
  if (arch === "arm64") {
    return (
      appImages.find((a) => has(a.name.toLowerCase(), [/arm64/, /aarch64/])) ||
      debs.find((a) => has(a.name.toLowerCase(), [/arm64/, /aarch64/])) ||
      appImages[0] ||
      debs[0]
    );
  }
  return (
    appImages.find((a) => has(a.name.toLowerCase(), [/x64/, /amd64/, /x86_64/])) ||
    debs.find((a) => has(a.name.toLowerCase(), [/x64/, /amd64/, /x86_64/])) ||
    appImages[0] ||
    debs[0]
  );
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    const request = https.get(url, { headers: DEFAULT_HEADERS }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        return resolve(downloadFile(response.headers.location, destination));
      }
      if (response.statusCode !== 200) {
        file.close();
        return reject(new Error(`Download failed: ${response.statusCode}`));
      }
      response.pipe(file);
      file.on("finish", () => file.close(() => resolve(destination)));
    });
    request.on("error", (error) => {
      file.close();
      reject(error);
    });
  });
}

async function downloadAndInstall(asset) {
  if (!asset?.browser_download_url) {
    throw new Error("No installer asset available");
  }

  if (process.platform !== "win32") {
    await shell.openExternal(asset.browser_download_url);
    return { status: "external" };
  }

  const fileName = asset.name || "shorts-lab-installer.exe";
  const targetDir = app.getPath("temp");
  const targetPath = path.join(targetDir, fileName);

  await downloadFile(asset.browser_download_url, targetPath);

  if (fileName.toLowerCase().endsWith(".msi")) {
    spawn("msiexec.exe", ["/i", targetPath], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn(targetPath, [], { detached: true, stdio: "ignore" }).unref();
  }

  app.quit();
  return { status: "installing" };
}

async function checkForUpdate({ owner, repo, channel }) {
  const currentVersion = app.getVersion();
  const releases = await fetchJson(
    `https://api.github.com/repos/${owner}/${repo}/releases`
  );
  const release = pickRelease(releases, channel);
  if (!release) {
    return { status: "none", currentVersion };
  }
  const latestVersion = normalizeVersion(release.tag_name);
  if (compareSemver(latestVersion, currentVersion) <= 0) {
    return { status: "none", currentVersion, latestVersion };
  }
  const asset = pickAsset(release.assets || []);
  return {
    status: "available",
    currentVersion,
    latestVersion,
    asset,
    release
  };
}

async function openUpdateUrl(url) {
  if (!url) return null;
  return shell.openExternal(url);
}

module.exports = { checkForUpdate, openUpdateUrl, downloadAndInstall };
