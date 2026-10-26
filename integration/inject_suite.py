#!/usr/bin/env python3
"""Integrate two locally built Vite editors into the native Retarget Android APK.

This script only touches the extracted COPY of AnimRetargetAndroid in the CI workspace.
The three source GitHub repositories are never modified.
"""
from __future__ import annotations
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ANDROID_NS = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID_NS)
ATTR_NAME = "{" + ANDROID_NS + "}name"
ATTR_EXPORTED = "{" + ANDROID_NS + "}exported"
ATTR_LABEL = "{" + ANDROID_NS + "}label"


def activity_class(name: str, package: str) -> str:
    if name.startswith("."):
        return package + name
    if "." not in name:
        return package + "." + name
    return name


def inject(project: Path, rig: Path, character: Path) -> None:
    app = project / "app"
    manifest_file = app / "src/main/AndroidManifest.xml"
    gradle_file = app / "build.gradle.kts"
    assert manifest_file.is_file(), f"Missing {manifest_file}"
    assert gradle_file.is_file(), f"Missing {gradle_file}"
    assert (rig / "create.html").is_file(), "Rig Animation Studio build missing create.html"
    assert (character / "index.html").is_file(), "Character Studio build missing index.html"

    # Preserve independent web build asset paths, including hashed JS, CSS and shaders.
    asset_dest = app / "src/main/assets/studio"
    asset_dest.mkdir(parents=True, exist_ok=True)
    for name, source in (("rig", rig), ("character", character)):
        dest = asset_dest / name
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(source, dest)

    tree = ET.parse(manifest_file)
    root = tree.getroot()
    application = root.find("application")
    if application is None:
        raise RuntimeError("AndroidManifest.xml has no application")

    package = root.attrib.get("package", "com.animretarget.app")
    launcher_activity = None
    for activity in application.findall("activity") + application.findall("activity-alias"):
        for intent in list(activity.findall("intent-filter")):
            names = [a.attrib.get(ATTR_NAME) for a in intent.findall("action")]
            categories = [a.attrib.get(ATTR_NAME) for a in intent.findall("category")]
            if "android.intent.action.MAIN" in names and "android.intent.category.LAUNCHER" in categories:
                launcher_activity = activity_class(activity.attrib[ATTR_NAME], package)
                activity.remove(intent)
    if not launcher_activity:
        raise RuntimeError("Cannot identify original Retarget launcher; integration aborted")

    # Give the unified hub the launcher role, keep original Retarget activity callable.
    for class_name in ("com.animretarget.app.StudioHubActivity", "com.animretarget.app.StudioWebActivity"):
        if any(a.attrib.get(ATTR_NAME) == class_name for a in application.findall("activity")):
            raise RuntimeError(f"Already exists: {class_name}")
    hub = ET.SubElement(application, "activity", {
        ATTR_NAME: "com.animretarget.app.StudioHubActivity",
        ATTR_LABEL: "Phoenix Unified Studio",
        ATTR_EXPORTED: "true",
    })
    filt = ET.SubElement(hub, "intent-filter")
    ET.SubElement(filt, "action", {ATTR_NAME: "android.intent.action.MAIN"})
    ET.SubElement(filt, "category", {ATTR_NAME: "android.intent.category.LAUNCHER"})
    ET.SubElement(application, "activity", {
        ATTR_NAME: "com.animretarget.app.StudioWebActivity",
        ATTR_EXPORTED: "false",
    })
    tree.write(manifest_file, encoding="utf-8", xml_declaration=True)

    # Additional dependencies block is valid Gradle Kotlin DSL and avoids
    # guessing the existing formatting of the native Retarget build file.
    gradle = gradle_file.read_text(encoding="utf-8")
    if "androidx.webkit:webkit:" not in gradle:
        gradle += '\n// Offline WebView asset loader for the two editors.\ndependencies { implementation("androidx.webkit:webkit:1.11.0") }\n'
        gradle_file.write_text(gradle, encoding="utf-8")

    code_dir = app / "src/main/java/com/animretarget/app"
    code_dir.mkdir(parents=True, exist_ok=True)
    hub_src = r'''package com.animretarget.app

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Entry screen that preserves native Retarget and embeds two offline editors. */
class StudioHubActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(15, 19, 26)
        window.navigationBarColor = Color.rgb(15, 19, 26)
        val scroll = ScrollView(this)
        scroll.setBackgroundColor(Color.rgb(17, 21, 30))
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(26, 32, 26, 26)
            gravity = Gravity.TOP
        }
        scroll.addView(content)
        val title = TextView(this).apply {
            text = "PHOENIX · CHARACTER SUITE"
            textSize = 23f
            setTextColor(Color.WHITE)
            setPadding(0, 18, 0, 24)
        }
        content.addView(title)
        val info = TextView(this).apply {
            text = "Три редактора в одном APK. GLB сохраняйте в файлы и открывайте в следующем модуле. Сквозной обмен сценой ещё не реализован."
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, 0, 0, 24)
        }
        content.addView(info)
        fun button(label: String, click: () -> Unit) {
            val btn = Button(this).apply {
                text = label
                setOnClickListener { click() }
            }
            content.addView(btn, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        button("1 · Rig Animation Studio") {
            startActivity(Intent(this, StudioWebActivity::class.java).putExtra("tool", "rig"))
        }
        button("2 · Anim Retarget") {
            startActivity(Intent().setClassName(this, "__RETARGET_ACTIVITY__"))
        }
        button("3 · Phoenix Character Studio") {
            startActivity(Intent(this, StudioWebActivity::class.java).putExtra("tool", "character"))
        }
        setContentView(scroll)
    }
}
'''.replace("__RETARGET_ACTIVITY__", launcher_activity)
    (code_dir / "StudioHubActivity.kt").write_text(hub_src, encoding="utf-8")

    web_src = r'''package com.animretarget.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.Button
import androidx.webkit.WebViewAssetLoader

/** Load built static Vite apps on a secure local https origin, without a server. */
class StudioWebActivity : Activity() {
    private val filePickerCode = 7071
    private var uploadCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var browser: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val tool = if (intent.getStringExtra("tool") == "rig") "rig" else "character"
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        browser = WebView(this)
        browser.settings.javaScriptEnabled = true
        browser.settings.domStorageEnabled = true
        browser.settings.allowFileAccess = false
        browser.settings.allowContentAccess = true
        browser.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                return request?.url?.let { loader.shouldInterceptRequest(it) }
            }
        }
        browser.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?, filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                uploadCallback?.onReceiveValue(null)
                uploadCallback = filePathCallback
                return try {
                    startActivityForResult(fileChooserParams!!.createIntent(), filePickerCode)
                    true
                } catch (error: Exception) {
                    uploadCallback?.onReceiveValue(null)
                    uploadCallback = null
                    false
                }
            }
        }
        val layout = LinearLayout(this)
        layout.orientation = LinearLayout.VERTICAL
        val back = Button(this).apply {
            text = "← Phoenix Studio"
            setOnClickListener { finish() }
        }
        layout.addView(back)
        layout.addView(browser, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(layout)
        val page = if (tool == "rig") "create.html" else "index.html"
        browser.loadUrl("https://appassets.androidplatform.net/assets/studio/$tool/$page")
    }

    @Deprecated("Android legacy activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == filePickerCode) {
            uploadCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            uploadCallback = null
        }
    }
    override fun onDestroy() {
        uploadCallback?.onReceiveValue(null)
        browser.destroy()
        super.onDestroy()
    }
}
'''
    (code_dir / "StudioWebActivity.kt").write_text(web_src, encoding="utf-8")
    print(f"Integrated native Retarget ({launcher_activity}) + offline Rig + Character.")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("Usage: inject_suite.py <native-project> <rig-dist> <character-dist>")
    inject(*[Path(arg).resolve() for arg in sys.argv[1:]])
