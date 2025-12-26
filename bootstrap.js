/**
 * ZotSeek - Semantic Search for Zotero - Bootstrap
 * Based on Zotero's official Make It Red example and BetterNotes plugin.
 */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  Zotero.debug("[ZotSeek Bootstrap] Waiting for initialization...");
  await Zotero.initializationPromise;
  Zotero.debug("[ZotSeek Bootstrap] Zotero initialized");

  // Register chrome content and locale
  Zotero.debug("[ZotSeek Bootstrap] Registering chrome content...");
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "zotseek", rootURI + "content/"],
    ["locale", "zotseek", "en-US", rootURI + "locale/en-US/"],
  ]);
  Zotero.debug("[ZotSeek Bootstrap] Chrome content and locale registered");

  // Create context for the plugin script
  // _globalThis allows the script to access this context
  const ctx = {
    rootURI,
    Zotero,
    // Provide document for fake browser environment
    document: Zotero.getMainWindow()?.document,
  };
  ctx._globalThis = ctx;

  // Load the main script
  Zotero.debug("[ZotSeek Bootstrap] Loading main script...");
  try {
    Services.scriptloader.loadSubScript(
      `${rootURI}content/scripts/index.js`,
      ctx
    );
    Zotero.debug("[ZotSeek Bootstrap] Main script loaded");
  } catch (e) {
    Zotero.debug("[ZotSeek Bootstrap] ERROR loading script: " + e);
    Zotero.logError(e);
    return;
  }

  // The script attaches itself to Zotero.ZotSeek
  if (Zotero.ZotSeek) {
    Zotero.debug("[ZotSeek Bootstrap] Calling onStartup...");
    Zotero.ZotSeek.setInfo({ id, version, rootURI });
    await Zotero.ZotSeek.hooks.onStartup();
    Zotero.debug("[ZotSeek Bootstrap] Startup complete");
  } else {
    Zotero.debug("[ZotSeek Bootstrap] ERROR: Zotero.ZotSeek not found!");
  }
}

function onMainWindowLoad({ window: win }) {
  Zotero.ZotSeek?.hooks.onMainWindowLoad(win);
}

function onMainWindowUnload({ window: win }) {
  Zotero.ZotSeek?.hooks.onMainWindowUnload(win);
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  Zotero.ZotSeek?.hooks.onShutdown();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}
