package com.retarget.app.bvh

import com.retarget.app.math.Math3D
import com.retarget.app.retarget.Retargeter
import java.util.Locale

/**
 * Экспорт результата ретаргета в BVH (сантиметры, каналы Z Y X).
 * Такой BVH открывается в Blender / Unity / Unreal / Godot.
 */
object BvhWriter {

    const val EXPORT_ORDER = "ZYX"

    fun write(r: Retargeter.Result, fps: Float, sb: StringBuilder) {
        val idx = HashMap<String, Int>()
        r.jointNames.forEachIndexed { i, n -> idx[n] = i }

        sb.append("HIERARCHY\n")
        fun emit(ti: Int, depth: Int) {
            val name = r.jointNames[ti]
            val pad = "  ".repeat(depth)
            val off = r.offsets[ti]
            if (r.parentIdx[ti] < 0) {
                sb.append("${pad}ROOT $name\n")
                sb.append("$pad{\n")
                // Mixamo-конвенция: OFFSET корня нулевой, абсолютная позиция живёт в каналах MOTION
                sb.append("$pad  OFFSET 0.00 0.00 0.00\n")
                sb.append("$pad  CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation\n")
            } else {
                sb.append("${pad}JOINT $name\n")
                sb.append("$pad{\n")
                sb.append("$pad  OFFSET ${cm(off[0])} ${cm(off[1])} ${cm(off[2])}\n")
                sb.append("$pad  CHANNELS 3 Zrotation Yrotation Xrotation\n")
            }
            val kids = (0 until r.jointNames.size).filter { r.parentIdx[it] == ti }
            for (k in kids) emit(k, depth + 1)
            if (kids.isEmpty()) {
                sb.append("$pad  End Site\n$pad  {\n$pad    OFFSET 0.0 2.0 0.0\n$pad  }\n")
            }
            sb.append("$pad}\n")
        }
        // корень = кость без родителя
        val rootIdx = r.parentIdx.indexOfFirst { it < 0 }
        emit(rootIdx, 0)

        sb.append("MOTION\n")
        sb.append("Frames: ${r.rootPos.size}\n")
        sb.append("Frame Time: ${String.format(Locale.US, "%.6f", if (fps > 0) 1f / fps else 1f / 30f)}\n")

        val frames = r.rootPos.size
        val gq = arrayOfNulls<FloatArray>(r.jointNames.size)
        for (f in 0 until frames) {
            val row = StringBuilder()
            // мировые кватернионы из локальных
            for (ti in r.jointNames.indices) {
                val p = r.parentIdx[ti]
                gq[ti] = if (p < 0) r.localQ[f][ti]
                         else Math3D.qNorm(Math3D.qMul(gq[p]!!, r.localQ[f][ti]))
            }
            for (ti in r.jointNames.indices) {
                val p = r.parentIdx[ti]
                if (p < 0) {
                    val t = r.rootPos[f]
                    row.append("${cm(t[0])} ${cm(t[1])} ${cm(t[2])} ")
                    val e = Math3D.toEulerZYX(r.localQ[f][ti])
                    row.append("${e[2].fmt()} ${e[1].fmt()} ${e[0].fmt()} ")
                } else {
                    val parentW = gq[p]!!
                    val local = Math3D.qNorm(Math3D.qMul(Math3D.qConj(parentW), gq[ti]!!))
                    val e = Math3D.toEulerZYX(local)
                    row.append("${e[2].fmt()} ${e[1].fmt()} ${e[0].fmt()} ")
                }
            }
            sb.append(row.toString().trim()).append('\n')
        }
    }

    private fun cm(m: Float): String = String.format(Locale.US, "%.2f", m * 100f)
    private fun Float.fmt(): String = String.format(Locale.US, "%.2f", this)
}
