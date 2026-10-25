package com.retarget.app.fbx

import java.util.zip.Inflater

/**
 * Минимальный парсер бинарного FBX 7.x (6.1-7.7):
 *  - скелет (Model LimbNode: Lcl Translation / PreRotation / Lcl Rotation)
 *  - анимация (AnimationStack -> Layer -> CurveNode -> Curve)
 * Соединения (Connections OO/OP) разрешаются в иерархию и привязку кривых.
 */
object FbxParser {

    class FbxNode(val name: String, val props: MutableList<Any?>, val children: MutableList<FbxNode>) {
        fun p(i: Int): Any? = if (props.size > i) props[i] else null
    }

    class FbxBone(
        val id: Long,
        val name: String,
        val lclT: FloatArray,          // локальная трансляция (bind)
        val qPre: FloatArray,          // PreRotation -> кватернион
        val qLclRest: FloatArray       // Lcl Rotation (rest) -> кватернион
    ) {
        var parent: FbxBone? = null
        val children = mutableListOf<FbxBone>()
    }

    class FbxStack(
        val name: String,
        var t0: Double,
        var t1: Double,
        // имя кости -> (T-кривые, R-кривые); кривая = ось 'X'/'Y'/'Z' -> (times, values)
        val bones: MutableMap<String, Pair<MutableMap<Char, Pair<FloatArray, FloatArray>>?, MutableMap<Char, Pair<FloatArray, FloatArray>>?>> = mutableMapOf()
    )

    class FbxScene(
        val bones: List<FbxBone>,
        val root: FbxBone?,
        val stacks: List<FbxStack>
    )

    // ------------------------ низкоуровневое чтение ------------------------

    private class Reader(val d: ByteArray, var off: Int) {
        fun u8(): Int = d[off++].toInt() and 0xFF
        fun i16(): Short { val v = le16(d, off); off += 2; return v }
        fun i32(): Int { val v = le32(d, off); off += 4; return v }
        fun i64(): Long { val v = le64(d, off); off += 8; return v }
        fun f32(): Float { val v = le32(d, off); off += 4; return Float.fromBits(v) }
        fun f64(): Double { val v = le64(d, off); off += 8; return Double.fromBits(v) }
    }

    private fun le16(d: ByteArray, o: Int): Short = ((d[o].toInt() and 0xFF) or ((d[o + 1].toInt() and 0xFF) shl 8)).toShort()
    private fun le32(d: ByteArray, o: Int): Int =
        (d[o].toInt() and 0xFF) or ((d[o + 1].toInt() and 0xFF) shl 8) or
                ((d[o + 2].toInt() and 0xFF) shl 16) or ((d[o + 3].toInt() and 0xFF) shl 24)
    private fun le64(d: ByteArray, o: Int): Long {
        var r = 0L
        for (i in 7 downTo 0) r = (r shl 8) or (d[o + i].toLong() and 0xFF)
        return r
    }

    private fun inflate(src: ByteArray): ByteArray {
        val inflater = Inflater()
        inflater.setInput(src)
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(65536)
        while (!inflater.finished()) {
            val n = inflater.inflate(buf)
            if (n == 0 && inflater.needsInput()) break
            out.write(buf, 0, n)
        }
        inflater.end()
        return out.toByteArray()
    }

    private fun readProps(r: Reader, count: Int, end: Long): MutableList<Any?> {
        val props = mutableListOf<Any?>()
        for (i in 0 until count) {
            if (r.off >= end) break
            val t = r.u8().toChar()
            when (t) {
                'Y' -> props.add(r.i16().toLong())
                'C' -> props.add(r.u8() != 0)
                'I' -> props.add(r.i32().toLong())
                'F' -> props.add(r.f32().toDouble())
                'D' -> props.add(r.f64())
                'L' -> props.add(r.i64())
                'f', 'd', 'l', 'i', 'b' -> {
                    val alen = r.i32(); val enc = r.i32(); val clen = r.i32()
                    var raw = r.d.copyOfRange(r.off, r.off + clen); r.off += clen
                    if (enc == 1) raw = inflate(raw)
                    when (t) {
                        'f' -> { val a = FloatArray(alen); var o = 0; for (j in 0 until alen) { a[j] = Float.fromBits(le32(raw, o)); o += 4 }; props.add(a) }
                        'd' -> { val a = DoubleArray(alen); var o = 0; for (j in 0 until alen) { a[j] = Double.fromBits(le64(raw, o)); o += 8 }; props.add(a) }
                        'l' -> { val a = LongArray(alen); var o = 0; for (j in 0 until alen) { a[j] = le64(raw, o); o += 8 }; props.add(a) }
                        'i' -> { val a = IntArray(alen); var o = 0; for (j in 0 until alen) { a[j] = le32(raw, o); o += 4 }; props.add(a) }
                        'b' -> props.add(null) // булевы массивы не встречаются в скелете/анимации
                    }
                }
                'S', 'R' -> {
                    val ln = r.i32()
                    val raw = r.d.copyOfRange(r.off, r.off + ln); r.off += ln
                    props.add(if (t == 'S') String(raw, Charsets.UTF_8) else raw)
                }
                else -> throw IllegalArgumentException("FBX: неизвестный тип свойства '$t' @${r.off - 1}")
            }
        }
        return props
    }

    private fun parseNodes(r: Reader, end: Long, wide: Boolean): MutableList<FbxNode> {
        val nodes = mutableListOf<FbxNode>()
        val hsz = if (wide) 25 else 13
        while (r.off < end - hsz) {
            val start = r.off
            val eoff = if (wide) r.i64() else r.i32().toLong()
            val nprops = if (wide) r.i64() else r.i32().toLong()
            val plen = if (wide) r.i64() else r.i32().toLong()
            if (eoff == 0L && nprops == 0L && plen == 0L) { r.off = start + hsz; break }
            if (eoff <= start || eoff > end) throw IllegalArgumentException("FBX: битый заголовок записи @${start}")
            val nameLen = r.u8()
            val name = String(r.d, r.off, nameLen, Charsets.US_ASCII); r.off += nameLen
            val props = readProps(r, nprops.toInt(), eoff)
            val node = FbxNode(name, props, mutableListOf())
            if (r.off < eoff) node.children.addAll(parseNodes(r, eoff, wide))
            nodes.add(node)
            r.off = eoff.toInt()
        }
        return nodes
    }

    // ------------------------ семантика FBX ------------------------

    fun parse(data: ByteArray): FbxScene {
        val version = le32(data, 23)
        val wide = version >= 7500
        val r = Reader(data, 27)
        val top = parseNodes(r, data.size.toLong(), wide)

        val objects = top.firstOrNull { it.name == "Objects" }?.children ?: emptyList()
        val conns = top.firstOrNull { it.name == "Connections" }?.children ?: emptyList()

        // кость -> список (родитель, проп)
        val c2p = HashMap<Long, MutableList<Pair<Long, String?>>>()
        val p2c = HashMap<Long, MutableList<Long>>()
        for (c in conns) {
            val type = c.p(0) as? String ?: continue
            val a = c.p(1) as? Long ?: continue
            val b = c.p(2) as? Long ?: continue
            if (type == "OO") {
                c2p.getOrPut(a) { mutableListOf() }.add(b to null)
                p2c.getOrPut(b) { mutableListOf() }.add(a)
            } else {
                val prop = c.p(3) as? String
                c2p.getOrPut(a) { mutableListOf() }.add(b to prop)
            }
        }

        fun clean(s: String) = s.substringBefore('\u0000').substringAfterLast(':')

        // скелет
        val id2bone = HashMap<Long, FbxBone>()
        val bones = mutableListOf<FbxBone>()
        for (o in objects) {
            if (o.name != "Model") continue
            if (o.p(2) != "LimbNode") continue
            val id = o.p(0) as Long
            val name = clean(o.p(1) as? String ?: "?")
            var lclT = floatArrayOf(0f, 0f, 0f)
            var qPre = floatArrayOf(0f, 0f, 0f, 1f)
            var qRest = floatArrayOf(0f, 0f, 0f, 1f)
            val props70 = o.children.firstOrNull { it.name == "Properties70" } ?: continue
            for (p in props70.children) {
                val nm = p.p(0) as? String ?: continue
                val nums = FloatArray(3)
                var n = 0
                for (k in 2 until p.props.size) {
                    val v = p.props[k]
                    if (v is Double) { if (n < 3) nums[n++] = v.toFloat() }
                    // строки-флаги ('A+', 'Vector' и т.п.) пропускаем
                }
                when (nm) {
                    "Lcl Translation" -> lclT = nums.copyOf()
                    "PreRotation" -> qPre = com.retarget.app.math.Math3D.fromEuler(nums, "XYZ")
                    "Lcl Rotation" -> qRest = com.retarget.app.math.Math3D.fromEuler(nums, "XYZ")
                }
            }
            val bone = FbxBone(id, name, lclT, qPre, qRest)
            id2bone[id] = bone
            bones.add(bone)
        }
        var root: FbxBone? = null
        for (b in bones) {
            val links = c2p[b.id] ?: continue
            val parentBone = links.firstOrNull { it.first in id2bone }?.let { id2bone[it.first] }
            if (parentBone != null) { b.parent = parentBone; parentBone.children.add(b) }
            else if (root == null) root = b
        }
        if (root == null && bones.isNotEmpty()) root = bones[0]

        // анимация
        val stacks = mutableListOf<FbxStack>()
        val id2obj = HashMap<Long, FbxNode>()
        for (o in objects) id2obj[o.p(0) as Long] = o
        val KTIME = 46186158000.0
        for (o in objects) {
            if (o.name != "AnimationStack") continue
            val st = FbxStack(clean(o.p(1) as? String ?: "stack"), Double.MAX_VALUE, -Double.MAX_VALUE)
            for (layerId in p2c[o.p(0) as Long] ?: emptyList()) {
                for (cnId in p2c[layerId] ?: emptyList()) {
                    val cn = id2obj[cnId] ?: continue
                    if (cn.name != "AnimationCurveNode") continue
                    val link = c2p[cnId]?.firstOrNull { it.first in id2bone && it.second != null } ?: continue
                    val bone = id2bone[link.first]!!
                    val prop = link.second!!
                    val isT = prop.contains("Translation")
                    val isR = prop.contains("Rotation")
                    if (!isT && !isR) continue
                    // кривые: OP -> curvenode, prop 'd|X' и т.п.
                    val crvs = HashMap<Char, Pair<FloatArray, FloatArray>>()
                    for (c in conns) {
                        val type = c.p(0) as? String ?: continue
                        if (type != "OP") continue
                        val parent = c.p(2) as? Long ?: continue
                        if (parent != cnId) continue
                        val dp = (c.p(3) as? String) ?: continue
                        if (!dp.startsWith("d|")) continue
                        val cu = id2obj[c.p(1) as? Long ?: continue] ?: continue
                        if (cu.name != "AnimationCurve") continue
                        var times: FloatArray? = null; var values: FloatArray? = null
                        for (ch in cu.children) {
                            val arr = ch.p(0)
                            when (ch.name) {
                                "KeyTime" -> if (arr is LongArray) {
                                    val t = FloatArray(arr.size)
                                    for (k in arr.indices) t[k] = (arr[k] / KTIME).toFloat()
                                    times = t
                                }
                                "KeyValueFloat" -> if (arr is FloatArray) values = arr
                            }
                        }
                        if (times != null && values != null && times.isNotEmpty() && values.isNotEmpty()) {
                            crvs[dp[2]] = times to values
                            st.t0 = minOf(st.t0, times.first().toDouble())
                            st.t1 = maxOf(st.t1, times.last().toDouble())
                        }
                    }
                    if (crvs.isEmpty()) continue
                    val entry = st.bones.getOrPut(bone.name) { null to null }
                    if (isT) {
                        val m = entry.first ?: HashMap<Char, Pair<FloatArray, FloatArray>>()
                        m.putAll(crvs)
                        st.bones[bone.name] = m to entry.second
                    } else {
                        val m = entry.second ?: HashMap<Char, Pair<FloatArray, FloatArray>>()
                        m.putAll(crvs)
                        st.bones[bone.name] = entry.first to m
                    }
                }
            }
            if (st.bones.isNotEmpty() && st.t1 >= st.t0) stacks.add(st)
        }
        return FbxScene(bones, root, stacks)
    }

    /** Линейная выборка значения кривой в момент t. */
    fun sample(times: FloatArray, values: FloatArray, t: Float): Float {
        if (times.isEmpty()) return 0f
        if (t <= times.first()) return values.first()
        if (t >= times.last()) return values.last()
        var lo = 0; var hi = times.size - 1
        while (hi - lo > 1) { val mid = (lo + hi) / 2; if (times[mid] <= t) lo = mid else hi = mid }
        val span = times[hi] - times[lo]
        if (span <= 1e-9f) return values[hi]
        val a = (t - times[lo]) / span
        return values[lo] * (1 - a) + values[hi] * a
    }
}
