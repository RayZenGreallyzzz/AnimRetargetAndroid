package com.retarget.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

import com.retarget.app.bvh.BvhParser
import com.retarget.app.bvh.BvhWriter
import com.retarget.app.fbx.FbxParser
import com.retarget.app.retarget.Retargeter
import com.retarget.app.util.MixamoZip

/**
 * BVH Retargeter — перенос анимации (BVH / ZIP от Mixamo / FBX) на скелет своего персонажа (FBX или BVH).
 * Результат — BVH, который открывается в Blender / Unity / Unreal / Godot.
 * Разница bind-поз (T-pose / A-pose), roll костей, оси и масштаб учитываются автоматически.
 */
class MainActivity : Activity() {

    private lateinit var log: TextView
    private lateinit var btnPickChar: Button
    private lateinit var btnPickAnim: Button
    private lateinit var btnRun: Button
    private lateinit var cbInPlace: CheckBox
    private lateinit var cbGroundFit: CheckBox

    private var charUri: Uri? = null
    private var animUri: Uri? = null
    private var animIsFbx: Boolean = false

    private val PICK_CHAR = 11
    private val PICK_ANIM = 12
    private val SAVE_BVH = 13

    private var pendingResult: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val ctx = this
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }

        val title = TextView(this).apply {
            text = "Ретаргетинг анимации на своего персонажа\n1) FBX/BVH персонажа  2) анимация BVH/ZIP/FBX  3) Сохранить BVH\nРазница T/A-поз, roll костей и оси учитываются автоматически"
            textSize = 15f
            setPadding(0, dp(8), 0, dp(16))
        }
        root.addView(title)

        btnPickChar = Button(this).apply { text = "1. Выбрать персонажа (.fbx или .bvh)" }
        btnPickChar.setOnClickListener {
            val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/octet-stream", "*/*"))
            }
            startActivityForResult(i, PICK_CHAR)
        }
        root.addView(btnPickChar)

        btnPickAnim = Button(this).apply { text = "2. Выбрать анимацию (.bvh / .zip / .fbx)" }
        btnPickAnim.setOnClickListener {
            val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/octet-stream", "application/zip", "*/*"))
            }
            startActivityForResult(i, PICK_ANIM)
        }
        root.addView(btnPickAnim)

        cbInPlace = CheckBox(this).apply { text = "На месте (убрать дрейф вперёд)" ; isChecked = true }
        root.addView(cbInPlace)
        cbGroundFit = CheckBox(this).apply { text = "Посадить на землю (авто-высота бёдер)"; isChecked = true }
        root.addView(cbGroundFit)

        btnRun = Button(this).apply { text = "3. Ретаргет → BVH" ; isEnabled = false }
        btnRun.setOnClickListener {
            try {
                btnRun.isEnabled = false
                log("Запуск ретаргета…")
                Thread {
                    try {
                        runRetarget()
                    } catch (e: Exception) {
                        log("ОШИБКА: ${e.message}")
                        runOnUiThread { btnRun.isEnabled = true }
                    }
                }.start()
            } catch (e: Exception) {
                log("ОШИБКА: ${e.message}")
            }
        }
        root.addView(btnRun)

        log = TextView(this).apply {
            textSize = 13f
            setPadding(0, dp(12), 0, 0)
            gravity = Gravity.TOP
        }
        root.addView(log, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        setContentView(ScrollView(this).apply { addView(root) })
        log("Готово к работе. Шаг 1 — файл персонажа.")
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun log(s: String) = runOnUiThread {
        log.text = log.text.toString() + "\n" + s
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK || data?.data == null) return
        val uri = data.data!!
        when (requestCode) {
            PICK_CHAR -> {
                charUri = uri
                log("Персонаж: ${nameOf(uri)}")
                btnRun.isEnabled = animUri != null
            }
            PICK_ANIM -> {
                animUri = uri
                val n = nameOf(uri).lowercase()
                animIsFbx = n.endsWith(".fbx")
                log("Анимация: ${nameOf(uri)}${if (animIsFbx) " (FBX)" else ""}")
                btnRun.isEnabled = charUri != null
            }
            SAVE_BVH -> {
                pendingResult?.let { txt ->
                    contentResolver.openOutputStream(uri)?.use { os ->
                        os.write(txt.toByteArray(Charsets.UTF_8))
                    }
                    log("Сохранено: ${nameOf(uri)} (${txt.length / 1024} КБ)")
                }
            }
        }
    }

    private fun nameOf(uri: Uri): String {
        val c = contentResolver.query(uri, null, null, null, null) ?: return uri.toString()
        c.use {
            val idx = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (it.moveToFirst() && idx >= 0) return it.getString(idx)
        }
        return uri.lastPathSegment ?: uri.toString()
    }

    private fun readAll(uri: Uri): ByteArray =
        contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: throw IllegalArgumentException("Не удалось прочитать файл")

    private fun runRetarget() {
        val charName = nameOf(charUri!!).lowercase()
        val charBytes = readAll(charUri!!)
        val (targetNodes, rootIdx) = if (charName.endsWith(".bvh")) {
            log("Персонаж BVH: ${charBytes.size / 1024} КБ, разбираю…")
            val charBvh = BvhParser.parse(String(charBytes, Charsets.UTF_8))
            Retargeter.buildTargetFromBvh(charBvh)
        } else {
            log("FBX персонажа: ${charBytes.size / 1024} КБ, разбираю…")
            val scene = FbxParser.parse(charBytes)
            log("Скелет: ${scene.bones.size} костей")
            Retargeter.buildTarget(scene)
        }

        val animBytes = readAll(animUri!!)
        val source: Retargeter.Source
        if (animIsFbx) {
            val animScene = FbxParser.parse(animBytes)
            val stack = animScene.stacks.maxByOrNull { it.t1 - it.t0 }
                ?: throw IllegalArgumentException("FBX: в файле нет анимации")
            log("FBX-анимация: стек \"${stack.name}\", ${"%.1f".format(stack.t1 - stack.t0)} с")
            source = Retargeter.FbxSource(animScene, stack)
        } else {
            val name = nameOf(animUri!!).lowercase()
            val bvhBytes = if (name.endsWith(".zip")) {
                val r = MixamoZip.extractBvh(animBytes)
                    ?: throw IllegalArgumentException("В ZIP не найден .bvh")
                log("ZIP: извлечён ${r.first}")
                r.second
            } else animBytes
            val text = String(bvhBytes, Charsets.UTF_8)
            val bvh = BvhParser.parse(text)
            log("BVH: ${bvh.frames} кадров, ${"%.2f".format(bvh.frameTime)} с/кадр")
            source = Retargeter.BvhSource(bvh)
        }

        val (tn, ri) = targetNodes to rootIdx
        val opt = Retargeter.Options(cbInPlace.isChecked, cbGroundFit.isChecked)
        log("Ретаргет: ${source.frames} кадров, ${tn.size} костей…")
        val result = Retargeter.retarget(tn, ri, source, opt)
        for (note in result.notes) log("  • $note")

        val sb = StringBuilder()
        BvhWriter.write(result, source.fps, sb)
        pendingResult = sb.toString()
        log("Готово! ${result.rootPos.size} кадров. Выберите куда сохранить…")
        runOnUiThread {
            val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "text/plain"
                putExtra(Intent.EXTRA_TITLE, "retargeted_walk.bvh")
            }
            startActivityForResult(i, SAVE_BVH)
            btnRun.isEnabled = true
        }
    }
}
