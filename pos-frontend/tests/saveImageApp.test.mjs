import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Download PNG did nothing in the phone app: a WebView ignores <a download>
// (owner, 2026-10-29). The app saves the image itself (FileSavePlugin).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const JAVA = "android/app/src/main/java/com/knotkitchen/pos/";

test("the app registers FileSave and saves into Pictures/KnotKitchen, or shares on Android 6-9", () => {
  assert.match(SRC(JAVA + "MainActivity.java"), /registerPlugin\(FileSavePlugin\.class\);/);
  const plugin = SRC(JAVA + "FileSavePlugin.java");
  assert.match(plugin, /@CapacitorPlugin\(name = "FileSave"\)/);
  assert.match(plugin, /public void saveImage\(PluginCall call\)/);
  assert.match(plugin, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.Q/);
  assert.match(plugin, /MediaStore\.Images\.Media\.RELATIVE_PATH, Environment\.DIRECTORY_PICTURES \+ "\/" \+ FOLDER/);
  assert.match(plugin, /FileProvider\.getUriForFile\(getContext\(\), getContext\(\)\.getPackageName\(\) \+ "\.fileprovider", file\)/);
  // The share path writes under cache/, which file_paths.xml exposes.
  assert.match(SRC("android/app/src/main/res/xml/file_paths.xml"), /<cache-path name="[^"]+" path="\." \/>/);
  // A file name from the page never becomes a path.
  assert.match(plugin, /replaceAll\("\[\^A-Za-z0-9\._-\]", "-"\)/);
});

test("the page saves through FileSave in the app, downloads in a browser, and asks an old app to update", () => {
  const save = SRC("src/utils/saveImage.js");
  assert.match(save, /const FileSave = registerPlugin\("FileSave"\);/);
  assert.match(save, /if \(!Capacitor\.isNativePlatform\(\)\) \{[\s\S]*link\.download = fileName;/);
  assert.match(save, /if \(!Capacitor\.isPluginAvailable\("FileSave"\)\) \{\s*enqueueSnackbar\("Update the KnotKitchen app to download images\. Print works now\.", \{ variant: "warning" \}\);/);
  assert.match(save, /FileSave\.saveImage\(\{ data, fileName, mimeType: "image\/png" \}\)/);
  assert.match(save, /enqueueSnackbar\(`Saved to \$\{res\.location\}\.`, \{ variant: "success", important: true \}\)/);
});

test("Export CSV saves through the app too: FileSave.saveFile into Downloads/KnotKitchen", () => {
  const plugin = SRC(JAVA + "FileSavePlugin.java");
  assert.match(plugin, /public void saveFile\(PluginCall call\)/);
  assert.match(plugin, /MediaStore\.Downloads\.RELATIVE_PATH, Environment\.DIRECTORY_DOWNLOADS \+ "\/" \+ FOLDER/);
  const save = SRC("src/utils/saveImage.js");
  assert.match(save, /FileSave\.saveFile\(\{ data, fileName, mimeType: blob\.type \|\| "application\/octet-stream" \}\)/);
  // An app from before saveFile (1.0.185) is told to update, not shown a raw error.
  assert.match(save, /err\?\.code === "UNIMPLEMENTED"/);
  const menu = SRC("src/components/dashboard/ManageMenu.jsx");
  assert.match(menu, /await saveBlob\(new Blob\(\[res\.data\], \{ type: "text\/csv" \}\), "knotkitchen_menu\.csv"\);/);
  assert.doesNotMatch(menu, /a\.download = "knotkitchen_menu\.csv"/);
});
