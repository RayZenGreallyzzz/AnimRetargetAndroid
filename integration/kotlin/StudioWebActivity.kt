package com.animretarget.app

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.util.UUID
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/**
 * Single APK, Rig Animation Studio's original interface is the default screen.
 * 'Retarget' opens the existing native Kotlin editor, 'Character' opens a second
 * offline WebView while keeping the Rig state in memory.
 *
 * External source repositories are never modified by this class.
 */
class StudioWebActivity : Activity() {
    private val chooserRequestCode = 7211
    private val exportRequestCode = 7212
    private val allowedDomain = "appassets.androidplatform.net"
    private lateinit var container: FrameLayout
    private val views = mutableMapOf<String, WebView>()
    @Volatile private var selected = "rig"
    fun currentTool(): String = selected
    private var uploadCallback: android.webkit.ValueCallback<Array<Uri>>? = null
    private var exportingFile: File? = null
    private lateinit var bridge: PhoenixWorkspaceBridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(18, 20, 27)
        window.navigationBarColor = Color.rgb(18, 20, 27)
        bridge = PhoenixWorkspaceBridge(this)
        container = FrameLayout(this)
        setContentView(container)
        openTool("rig")
    }

    fun openTool(name: String) {
        if (name == "retarget") {
            try {
                // Exact former launcher activity is supplied by the integration script.
                startActivity(Intent().setClassName(this, "__NATIVE_RETARGET_ACTIVITY__"))
            } catch (e: Exception) {
                Toast.makeText(this, "Ретаргетинг: " + e.message, Toast.LENGTH_LONG).show()
            }
            return
        }
        val next = if (name == "character") "character" else "rig"
        if (next == selected && views[next]?.visibility == android.view.View.VISIBLE) return
        views[selected]?.apply {
            onPause()
            visibility = android.view.View.GONE
        }
        val web = views[next] ?: createEditor(next).also {
            views[next] = it
            container.addView(it, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        selected = next
        web.visibility = android.view.View.VISIBLE
        web.bringToFront()
        web.onResume()
        // Notify an already-loaded editor that another module has published a newer GLB.
        web.evaluateJavascript("window.dispatchEvent(new Event('phoenix:activated'))", null)
    }

    private fun createEditor(name: String): WebView {
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        val web = WebView(this)
        val settings = web.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = true
        settings.loadsImagesAutomatically = true
        settings.mediaPlaybackRequiresUserGesture = true
        settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        // The native interface is available ONLY inside our packaged offline origin.
        web.addJavascriptInterface(bridge, "PhoenixNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?, request: WebResourceRequest?
            ): WebResourceResponse? {
                return request?.url?.let { loader.shouldInterceptRequest(it) }
            }
            override fun shouldOverrideUrlLoading(
                view: WebView?, request: WebResourceRequest?
            ): Boolean {
                val url = request?.url ?: return true
                if (url.scheme == "https" && url.host == allowedDomain &&
                    url.path?.startsWith("/assets/studio/") == true) return false
                // Reject navigation to untrusted origins from the privileged editor.
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                } catch (_: Exception) {
                    Toast.makeText(this@StudioWebActivity,"Внешняя ссылка недоступна",Toast.LENGTH_SHORT).show()
                }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: android.webkit.ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                uploadCallback?.onReceiveValue(null)
                uploadCallback = filePathCallback
                return try {
                    startActivityForResult(fileChooserParams!!.createIntent(), chooserRequestCode)
                    true
                } catch (e: Exception) {
                    uploadCallback?.onReceiveValue(null)
                    uploadCallback = null
                    Toast.makeText(this@StudioWebActivity,"Не удалось открыть файлы",Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }
        val page = if (name == "rig") "create.html" else "index.html"
        web.loadUrl("https://appassets.androidplatform.net/assets/studio/$name/$page")
        return web
    }

    fun exportFileToPicker(file: File) {
        if (!file.isFile) return
        exportingFile = file
        val type = when (file.extension.lowercase()) {
            "glb" -> "model/gltf-binary"
            "gltf", "json", "pcs" -> "application/json"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "zip" -> "application/zip"
            else -> "application/octet-stream"
        }
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            setType(type)
            putExtra(Intent.EXTRA_TITLE, file.name)
        }
        try {
            startActivityForResult(intent, exportRequestCode)
        } catch (e: Exception) {
            Toast.makeText(this, "Не удалось открыть сохранение: " + e.message, Toast.LENGTH_LONG).show()
        }
    }

    @Deprecated("Android legacy result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when(requestCode) {
            chooserRequestCode -> {
                uploadCallback?.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(resultCode, data))
                uploadCallback = null
            }
            exportRequestCode -> {
                val src = exportingFile
                exportingFile = null
                if (resultCode == RESULT_OK && src != null && data?.data != null) {
                    try {
                        contentResolver.openOutputStream(data.data!!)?.use { output ->
                            FileInputStream(src).use { input -> input.copyTo(output, 65536) }
                        } ?: error("Нет доступа к выбранному файлу")
                        Toast.makeText(this,"Сохранено: " + src.name,Toast.LENGTH_SHORT).show()
                    } catch (e: Exception) {
                        Toast.makeText(this,"Ошибка экспорта: " + e.message,Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    override fun onPause() {
        views[selected]?.onPause()
        super.onPause()
    }
    override fun onResume() {
        super.onResume()
        views[selected]?.onResume()
        views[selected]?.evaluateJavascript("window.dispatchEvent(new Event('phoenix:activated'))", null)
    }
    override fun onBackPressed() {
        if(selected == "character") {
            openTool("rig")
        } else if (views["rig"]?.canGoBack() == true) {
            views["rig"]?.goBack()
        } else {
            super.onBackPressed()
        }
    }
    override fun onDestroy() {
        uploadCallback?.onReceiveValue(null)
        uploadCallback = null
        views.values.forEach {
            container.removeView(it)
            it.removeJavascriptInterface("PhoenixNative")
            it.destroy()
        }
        views.clear()
        bridge.close()
        super.onDestroy()
    }
}

/**
 * Workspace transfer is chunked: no full base64 GLB needs to cross the bridge
 * in one call. Files remain private until the user explicitly exports via SAF.
 */
private class PhoenixWorkspaceBridge(private val app: StudioWebActivity) {
    private val directory = File(app.filesDir, "phoenix_workspace").apply { mkdirs() }
    private val metadata = app.getSharedPreferences("phoenix_suite_workspace_v2", Activity.MODE_PRIVATE)
    private val pendingDir = File(app.cacheDir, "phoenix_workspace_pending").apply { mkdirs() }
    private val filePattern = Regex("[^a-zA-Z0-9А-Яа-яЁё._ ()-]")
    private var pendingName: String? = null
    private var pendingToken: String? = null
    private var pendingOutput: FileOutputStream? = null
    private var pendingTemp: File? = null
    private var expectedBytes = 0L
    private var writtenBytes = 0L

    private fun sanitized(input: String): String {
        var s = input.substringAfterLast('/').substringAfterLast('\\')
            .replace(filePattern, "_").take(140).trim('.', ' ')
        if(s.isBlank()) s = "character.glb"
        return s
    }
    private fun approved(name: String): File? {
        val safe = sanitized(name)
        if (safe != name) return null
        return File(directory, safe).takeIf { it.isFile }
    }

    @JavascriptInterface
    fun openTool(tool: String) {
        if (tool !in setOf("rig", "retarget", "character")) return
        app.runOnUiThread { app.openTool(tool) }
    }

    @JavascriptInterface @Synchronized
    fun beginSave(name: String, size: Long): String {
        if (pendingOutput != null || size < 0 || size > 300L*1024*1024) return ""
        return try {
            val filename = sanitized(name)
            val token = UUID.randomUUID().toString()
            val file = File(pendingDir, token + ".tmp")
            pendingOutput = FileOutputStream(file)
            pendingName = filename
            pendingToken = token
            pendingTemp = file
            expectedBytes = size
            writtenBytes = 0
            token
        } catch (_: Exception) { "" }
    }

    @JavascriptInterface @Synchronized
    fun appendSaveChunk(token: String, base64: String): Boolean {
        if(token != pendingToken || pendingOutput == null) return false
        return try {
            val chunk = Base64.decode(base64, Base64.DEFAULT)
            if(chunk.size > 131072 || writtenBytes + chunk.size > expectedBytes) return false
            pendingOutput!!.write(chunk)
            writtenBytes += chunk.size
            true
        } catch (_: Exception) {false}
    }

    @JavascriptInterface @Synchronized
    fun finishSave(token: String): Boolean {
        if(token != pendingToken || writtenBytes != expectedBytes) return false
        return try {
            pendingOutput?.flush()
            pendingOutput?.close()
            pendingOutput = null
            var output = File(directory, pendingName!!)
            if(output.exists()) {
                val basename = output.nameWithoutExtension
                val ext = output.extension.let {if(it.isEmpty()) "" else ".$it"}
                var counter = 2
                while(output.exists()) output = File(directory, basename + "_" + (counter++) + ext)
            }
            val success = pendingTemp!!.renameTo(output)
            if (success && output.extension.equals("glb", ignoreCase = true)) {
                markActive(output, app.currentTool())
            }
            reset()
            success
        } catch (_: Exception) {reset(); false}
    }

    @JavascriptInterface @Synchronized
    fun cancelSave(token: String) {
        if(token == pendingToken) reset()
    }
    @Synchronized
    fun close() = reset()
    private fun reset() {
        try { pendingOutput?.close() } catch (_: Exception) {}
        pendingTemp?.delete()
        pendingOutput = null
        pendingToken = null
        pendingName = null
        pendingTemp = null
        writtenBytes = 0L
        expectedBytes = 0L
    }

    /**
     * Only a fully written GLB becomes the active project.
     * The monotonically increasing revision enables cross-WebView change detection.
     */
    @Synchronized
    private fun markActive(file: File, origin: String) {
        val revision = metadata.getLong("revision", 0L) + 1L
        metadata.edit()
            .putString("name", file.name)
            .putString("origin", origin)
            .putLong("revision", revision)
            .putLong("size", file.length())
            .apply()
    }

    @JavascriptInterface @Synchronized
    fun getActiveFileJson(): String {
        val name = metadata.getString("name", null)
        if (name.isNullOrBlank()) return "{}"
        val file = approved(name) ?: return "{}"
        return JSONObject()
            .put("name", file.name)
            .put("size", file.length())
            .put("revision", metadata.getLong("revision", 0L))
            .put("origin", metadata.getString("origin", "unknown"))
            .toString()
    }

    @JavascriptInterface @Synchronized
    fun setActiveFile(name: String, origin: String): Boolean {
        if (!name.lowercase().endsWith(".glb")) return false
        val file = approved(name) ?: return false
        markActive(file, origin.take(40))
        return true
    }

    @JavascriptInterface
    fun listFiles(): String {
        val files = directory.listFiles()?.filter { it.isFile }?.sortedByDescending { it.lastModified() }.orEmpty()
        val a = JSONArray()
        for (file in files) {
            a.put(JSONObject().put("name",file.name).put("size",file.length()))
        }
        return a.toString()
    }
    @JavascriptInterface
    fun getFileSize(name: String): Long = approved(name)?.length() ?: -1L

    @JavascriptInterface
    fun readFileChunk(name: String, offset: Long, length: Int): String {
        val file = approved(name) ?: return ""
        if(offset < 0 || offset >= file.length() || length < 1 || length > 65536) return ""
        return try {
            RandomAccessFile(file, "r").use { stream ->
                stream.seek(offset)
                val buf = ByteArray(minOf(length.toLong(),file.length()-offset).toInt())
                stream.readFully(buf)
                Base64.encodeToString(buf,Base64.NO_WRAP)
            }
        } catch (_: Exception) { "" }
    }

    @JavascriptInterface
    fun exportFile(name: String): Boolean {
        val file = approved(name) ?: return false
        app.runOnUiThread {app.exportFileToPicker(file)}
        return true
    }
}
