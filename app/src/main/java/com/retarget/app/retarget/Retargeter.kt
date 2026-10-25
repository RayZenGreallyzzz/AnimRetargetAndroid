package com.retarget.app.retarget

import com.retarget.app.bvh.Bvh
import com.retarget.app.bvh.BvhJoint
import com.retarget.app.fbx.FbxParser
import com.retarget.app.math.Math3D
import kotlin.math.abs
import kotlin.math.min

/**
 * Ретаргетинг вращений через мировые дельты от bind-позы:
 *
 *   S(j,t)          = srcGlobal_j(t) * inv(srcBindGlobal_j)     — мировой «свинг» кости источника
 *   S'(j,t)         = Q * S(j,t) * inv(Q)                       — поправка на несовпадение вертикальной оси
 *   tgtGlobal_j(t)  = S'(j,t) * tgtBindGlobal_j                 — дельта применяется СЛЕВА, в мировых осях
 *   tgtLocal_j(t)   = inv(tgtGlobal_parent(j,t)) * tgtGlobal_j(t) — родитель АНИМИРОВАННЫЙ
 *
 * Дельта слева даёт: сгиб локтя происходит вокруг той же мировой оси, что у источника —
 * roll/PreRotation цели не искажают направление сгиба; кости без пары едут с анимированным родителем.
 * Это автоматически учитывает РАЗНЫЕ bind-ПОЗЫ (T-pose источника vs A-pose цели), разные ориентации
 * костей (bone roll / PreRotation), разные пропорции (трансляции цели родные) и порядок эйлеров.
 * Корень: позиция масштабируется по отношению длин ног, опции inPlace / groundFit.
 */
object Retargeter {

    class Result(
        val jointNames: List<String>,
        val parentIdx: IntArray,
        val offsets: Array<FloatArray>,      // метры, локальные (bind целевого скелета)
        val rootPos: Array<FloatArray>,      // метры, мир
        val localQ: Array<Array<FloatArray>>, // [кадр][кость] кватернионы локальные
        val notes: List<String> = emptyList() // диагностика для лога (позы, оси, масштаб, сопоставление)
    )

    private fun normalize(name: String): String {
        var s = name.lowercase().replace("mixamorig:", "").replace("mixamorig", "")
        // сторона: полные слова, суффиксы Blender (.L / _l) или префиксы l_/r_
        var side = ""
        val raw = s
        if (raw.contains("left")) side = "L"
        else if (raw.contains("right")) side = "R"
        else if (raw.endsWith(".l") || raw.endsWith("_l")) side = "L"
        else if (raw.endsWith(".r") || raw.endsWith("_r")) side = "R"
        else if (Regex("(^|[._-])(l|r)([._-]|\\d|\$)").containsMatchIn(raw)) {
            side = if (Regex("(^|[._-])l([._-]|\\d|\$)").containsMatchIn(raw)) "L" else "R"
        }
        var base = raw.replace("left", "").replace("right", "")
            .replace(Regex("[._-]+[lr]\$"), "").replace(Regex("^[lr][._-]+"), "")
        val sb = StringBuilder()
        for (c in base) if (c.isLetterOrDigit()) sb.append(c)
        base = sb.toString()
        // цифровые суффиксы: spine001 -> spine1, thumb01 -> thumb1 (только в конце имени)
        base = base.replace(Regex("([a-z]+)0*(\\d+)$")) { m ->
            m.groupValues[1] + (m.groupValues[2].toIntOrNull() ?: 0)
        }
        // синонимы -> канонические имена Mixamo-стиля
        val canon = mapOf(
            "thigh" to "upleg", "calf" to "leg", "shin" to "leg", "knee" to "leg",
            "clavicle" to "shoulder", "upperarm" to "arm", "lowerarm" to "forearm",
            "elbow" to "forearm", "wrist" to "hand", "ankle" to "foot",
            "pelvis" to "hips", "root" to "hips", "ball" to "toe", "toebase" to "toe", "toe" to "toe",
            "thumb1" to "handthumb1", "thumb2" to "handthumb2", "thumb3" to "handthumb3",
            "index1" to "handindex1", "index2" to "handindex2", "index3" to "handindex3",
            "middle1" to "handmiddle1", "middle2" to "handmiddle2", "middle3" to "handmiddle3",
            "ring1" to "handring1", "ring2" to "handring2", "ring3" to "handring3",
            "pinky1" to "handpinky1", "pinky2" to "handpinky2", "pinky3" to "handpinky3"
        )
        base = canon[base] ?: base
        return if (side.isEmpty()) base else "S$side$base"
    }

    /** BVH may have zero root translation even when offsets are in centimeters.
     * Use humanoid bone segment magnitudes as the primary scale hint.
     */
    private fun bvhUnitScale(bvh: Bvh): Float {
        // Prefer leg / major arm lengths: a centimeter BVH can have dozens of
        // tiny finger offsets, making the median of *all* bones misleading.
        val major = bvh.order.asSequence().filter { !it.isRoot }.filter { j ->
            val n = normalize(j.name)
            n.endsWith("upleg") || n.endsWith("leg") || n.endsWith("forearm") || n.endsWith("arm")
        }.map { Math3D.vLen(it.offset) }.filter { it > 1e-4f }.toList()
        val scaleHint = major.maxOrNull()
            ?: bvh.order.asSequence().filter { !it.isRoot }
                .map { Math3D.vLen(it.offset) }.maxOrNull() ?: 0f
        return if (scaleHint > 3f || (scaleHint == 0f && Math3D.vLen(bvh.rootPos(0)) > 3f)) 0.01f else 1f
    }

    // ---------------- целевой скелет (FBX) ----------------

    class TNode(
        val name: String,
        val parentIdx: Int,                  // -1 у корня
        val lclT: FloatArray,                // метры
        val bindGlobalQ: FloatArray,
        val bindGlobalT: FloatArray
    )

    fun buildTarget(scene: FbxParser.FbxScene): Pair<List<TNode>, Int> {
        val nodes = mutableListOf<TNode>()
        val idxOf = HashMap<FbxParser.FbxBone, Int>()
        val root = scene.root ?: throw IllegalArgumentException("FBX: скелет не найден")

        fun add(b: FbxParser.FbxBone, parentIdx: Int) {
            val qLcl = Math3D.qMul(b.qPre, b.qLclRest)
            val gq: FloatArray; val gt: FloatArray
            if (parentIdx < 0) {
                gq = qLcl; gt = b.lclT.copyOf()
            } else {
                val p = nodes[parentIdx]
                gq = Math3D.qNorm(Math3D.qMul(p.bindGlobalQ, qLcl))
                gt = Math3D.vAdd(p.bindGlobalT, Math3D.qRot(p.bindGlobalQ, b.lclT))
            }
            idxOf[b] = nodes.size
            nodes.add(TNode(b.name, parentIdx, b.lclT.copyOf(), gq, gt))
            val myIdx = nodes.size - 1
            for (c in b.children) add(c, myIdx)
        }
        add(root, -1)
        return nodes to idxOf[root]!!
    }

    /**
     * Целевой скелет из BVH (персонаж, экспортированный в BVH из Blender и т.п.).
     * Bind-вращения костей в BVH = identity, форма скелета (T/A-поза) задана OFFSET-ами.
     * Если в BVH есть MOTION — он игнорируется, берётся только иерархия (bind).
     */
    fun buildTargetFromBvh(bvh: Bvh): Pair<List<TNode>, Int> {
        val unit = bvhUnitScale(bvh) // сантиметры или метры: смотрим длины костей, а не корень
        val nodes = mutableListOf<TNode>()
        val idxOf = HashMap<BvhJoint, Int>()
        // bind-высота корня: OFFSET иерархии, а если он нулевой (Mixamo) — позиция из первого кадра
        val rootOff = bvh.root.offset
        val rootBind = if (Math3D.vLen(rootOff) > 1e-4f) floatArrayOf(rootOff[0] * unit, rootOff[1] * unit, rootOff[2] * unit)
                       else floatArrayOf(bvh.rootPos(0)[0] * unit, bvh.rootPos(0)[1] * unit, bvh.rootPos(0)[2] * unit)
        fun add(j: BvhJoint, parentIdx: Int, bindT: FloatArray) {
            val isRoot = parentIdx < 0
            val off = if (isRoot) rootBind.copyOf()
                      else floatArrayOf(j.offset[0] * unit, j.offset[1] * unit, j.offset[2] * unit)
            val gq = if (isRoot) Math3D.IDENTITY_Q.copyOf() else nodes[parentIdx].bindGlobalQ
            val gt = if (isRoot) off.copyOf() else Math3D.vAdd(nodes[parentIdx].bindGlobalT, off)
            idxOf[j] = nodes.size
            nodes.add(TNode(j.name, parentIdx, off, gq, gt))
            val myIdx = nodes.size - 1
            for (c in j.children) add(c, myIdx, off)
        }
        add(bvh.root, -1, rootBind)
        return nodes to idxOf[bvh.root]!!
    }

    // ---------------- источник ----------------

    interface Source {
        val jointNames: List<String>
        val parentIdx: IntArray
        val bindGlobalQ: List<FloatArray>
        val bindGlobalT: List<FloatArray>                 // мировые позиции bind-позы, метры
        val bindRootPos: FloatArray                       // метры
        val frames: Int
        val fps: Float
        fun globalQ(f: Int, j: Int): FloatArray           // мировая ориентация в кадре
        fun rootPos(f: Int): FloatArray                   // мировая позиция корня, метры
        fun legLength(): Float                            // длина ног (метры), 0 если не найти
    }

    class BvhSource(private val bvh: Bvh) : Source {
        // единицы: Mixamo BVH — сантиметры; эвристика по длине позиции корня в первом кадре
        private val unitScale: Float = bvhUnitScale(bvh)
        override val jointNames = bvh.order.map { it.name }
        override val parentIdx: IntArray = IntArray(bvh.order.size) { idx ->
            val j = bvh.order[idx]
            if (j.parent == null) -1 else bvh.order.indexOf(j.parent!!)
        }
        override val bindGlobalQ: List<FloatArray> = bvh.order.map { Math3D.IDENTITY_Q.copyOf() }
        // bind-позиции BVH: вращения в bind = identity, миры = сумма оффсетов по цепочке
        override val bindGlobalT: List<FloatArray> = run {
            val out = ArrayList<FloatArray>(bvh.order.size)
            for (idx in bvh.order.indices) {
                val j = bvh.order[idx]
                val off = floatArrayOf(j.offset[0] * unitScale, j.offset[1] * unitScale, j.offset[2] * unitScale)
                val p = parentIdx[idx]
                out.add(if (p < 0) off else Math3D.vAdd(out[p], off))
            }
            out
        }
        override val bindRootPos = run {
            // bind-позиция корня: OFFSET иерархии, а если он нулевой (Mixamo) — из первого кадра
            val o = bvh.root.offset
            if (Math3D.vLen(o) > 1e-4f) floatArrayOf(o[0] * unitScale, o[1] * unitScale, o[2] * unitScale)
            else floatArrayOf(bvh.rootPos(0)[0] * unitScale, bvh.rootPos(0)[1] * unitScale, bvh.rootPos(0)[2] * unitScale)
        }
        override val frames = bvh.frames
        override val fps: Float = if (bvh.frameTime > 0) 1f / bvh.frameTime else 30f

        private val orders = bvh.order.map { j ->
            buildString {
                for (c in j.channels) {
                    if (c.endsWith("rotation", ignoreCase = true)) append(c[0])
                }
            }.let { if (it.length == 3) it else "XYZ" }
        }

        private val frameQ = Array(bvh.frames) { f ->
            Array(bvh.order.size) { Math3D.IDENTITY_Q.copyOf() }
        }

        init {
            for (f in 0 until bvh.frames) {
                for (idx in bvh.order.indices) {
                    val j = bvh.order[idx]
                    val e = bvh.eulers(f, j)
                    val q = Math3D.fromEuler(e, orders[idx])
                    val p = parentIdx[idx]
                    frameQ[f][idx] = if (p < 0) q else Math3D.qNorm(Math3D.qMul(frameQ[f][p], q))
                }
            }
        }

        override fun globalQ(f: Int, j: Int) = frameQ[f][j]
        override fun rootPos(f: Int): FloatArray {
            val p = bvh.rootPos(f)
            return floatArrayOf(p[0] * unitScale, p[1] * unitScale, p[2] * unitScale)
        }
        override fun legLength(): Float {
            var sum = 0f; var found = 0
            for ((idx, j) in bvh.order.withIndex()) {
                val n = normalize(j.name)
                if (n == "Supleg" || n == "Sleg" || n.endsWith("upleg") || n.endsWith("leg")) {
                    sum += (kotlin.math.sqrt(
                        j.offset[0] * j.offset[0] + j.offset[1] * j.offset[1] + j.offset[2] * j.offset[2]
                    ) * unitScale)
                    found++
                }
            }
            return if (found >= 4) sum / 2f else 0f
        }
    }

    class FbxSource(private val scene: FbxParser.FbxScene, private val stack: FbxParser.FbxStack) : Source {
        private val bones = scene.bones
        private val idxOf = HashMap<FbxParser.FbxBone, Int>()
        private val list = mutableListOf<FbxParser.FbxBone>()

        override val jointNames: List<String>
        override val parentIdx: IntArray
        override val bindGlobalQ: List<FloatArray>
        override val bindGlobalT: List<FloatArray>
        override val bindRootPos: FloatArray
        override val frames: Int
        override val fps = 30f

        init {
            val root = scene.root ?: throw IllegalArgumentException("FBX: скелет не найден")
            fun rec(b: FbxParser.FbxBone) { list.add(b); idxOf[b] = list.size - 1; b.children.forEach { rec(it) } }
            rec(root)
            jointNames = list.map { it.name }
            parentIdx = IntArray(list.size) { idx ->
                val p = list[idx].parent
                if (p == null) -1 else idxOf[p]!!
            }
            val gq = arrayOfNulls<FloatArray>(list.size)
            val gt = arrayOfNulls<FloatArray>(list.size)
            for (idx in list.indices) {
                val b = list[idx]
                val qLcl = Math3D.qMul(b.qPre, b.qLclRest)
                val p = parentIdx[idx]
                if (p < 0) { gq[idx] = qLcl; gt[idx] = b.lclT.copyOf() }
                else {
                    gq[idx] = Math3D.qNorm(Math3D.qMul(gq[p]!!, qLcl))
                    gt[idx] = Math3D.vAdd(gt[p]!!, Math3D.qRot(gq[p]!!, b.lclT))
                }
            }
            bindGlobalQ = gq.map { it!! }
            bindGlobalT = gt.map { it!! }
            bindRootPos = gt[parentIdx.indexOf(-1)]!!.copyOf()
            frames = min(1500, ((stack.t1 - stack.t0) * fps).toInt().coerceAtLeast(2))
        }

        override fun globalQ(f: Int, j: Int): FloatArray {
            val b = list[j]
            val d = stack.bones[b.name]?.second
            val qLcl = if (d != null && d.isNotEmpty()) {
                val e = FloatArray(3)
                for ((ax, crv) in d) e["XYZ".indexOf(ax)] = FbxParser.sample(crv.first, crv.second, stack.t0.toFloat() + f / fps)
                Math3D.qMul(b.qPre, Math3D.fromEuler(e, "XYZ"))
            } else Math3D.qMul(b.qPre, b.qLclRest)
            val p = parentIdx[j]
            return if (p < 0) qLcl else Math3D.qNorm(Math3D.qMul(globalQ(f, p), qLcl))
        }

        override fun rootPos(f: Int): FloatArray {
            val b = list[0]
            val d = stack.bones[b.name]?.first
            if (d != null && d.isNotEmpty()) {
                val t = b.lclT.copyOf()
                for ((ax, crv) in d) t["XYZ".indexOf(ax)] = FbxParser.sample(crv.first, crv.second, stack.t0.toFloat() + f / fps)
                return t
            }
            return bindRootPos.copyOf()
        }

        override fun legLength(): Float {
            var sum = 0f; var found = 0
            for (b in list) {
                val n = normalize(b.name)
                if (n.endsWith("upleg") || n == "Sleg" || n == "SUpLeg" || n.endsWith("leg")) {
                    sum += Math3D.vLen(b.lclT); found++
                }
            }
            return if (found >= 4) sum / 2f else 0f
        }
    }

    // ---------------- сам ретаргет ----------------

    class Options(val inPlace: Boolean, val groundFit: Boolean, val maxFrames: Int = 1500)

    fun retarget(targetNodes: List<TNode>, targetRootIdx: Int, source: Source, opt: Options): Result {
        val n = targetNodes.size
        // сопоставление костей
        val srcIdxOf = HashMap<String, Int>()
        source.jointNames.forEachIndexed { i, nm -> srcIdxOf[normalize(nm)] = i }
        val match = IntArray(n) { -1 }   // target idx -> source idx
        targetNodes.forEachIndexed { ti, tn ->
            srcIdxOf[normalize(tn.name)]?.let { match[ti] = it }
        }

        val frames = min(source.frames, opt.maxFrames)
        val scale = run {
            val sl = source.legLength(); val tl = targetLegLength(targetNodes)
            if (sl > 1e-4f && tl > 1e-4f) tl / sl else 1f
        }

        // ---- диагностика для лога: позы, оси, масштаб, сопоставление ----
        val notes = mutableListOf<String>()
        notes.add(poseNote("Источник", source.jointNames, source.bindGlobalT))
        notes.add(poseNote("Цель", targetNodes.map { it.name }, targetNodes.map { it.bindGlobalT }))
        val Qfix = run {
            val upS = upHint(source.jointNames, source.bindGlobalT)
            val upT = upHint(targetNodes.map { it.name }, targetNodes.map { it.bindGlobalT })
            if (upS == null || upT == null) Math3D.IDENTITY_Q.copyOf()
            else {
                val d = Math3D.vDot(upS, upT)
                if (d > 0.7f) Math3D.IDENTITY_Q.copyOf()
                else {
                    notes.add("Вертикальная ось цели не совпадает с источником — применена авто-коррекция")
                    Math3D.qBetween(upS, upT)
                }
            }
        }
        if (Qfix[3] > 0.9999f) notes.add("Системы координат совпадают (коррекция осей не нужна)")
        if (abs(scale - 1f) > 0.01f) notes.add("Масштаб корня: x${"%.2f".format(scale)} (по длине ног)")
        val unmatched = targetNodes.filterIndexed { ti, _ -> match[ti] < 0 }.map { it.name }
        notes.add("Сопоставлено костей: ${match.count { it >= 0 }} из $n" +
                (if (unmatched.isNotEmpty()) "; без пары (останутся в bind-позе): " +
                        unmatched.take(10).joinToString(", ") + (if (unmatched.size > 10) " …" else "") else ""))

        val rootPosOut = Array(frames) { FloatArray(3) }
        val localQOut = Array(frames) { Array(n) { Math3D.IDENTITY_Q.copyOf() } }

        val rootT = targetNodes[targetRootIdx]
        val groundLowest = FloatArray(frames)

        for (f in 0 until frames) {
            val gq = arrayOfNulls<FloatArray>(n)
            val gt = arrayOfNulls<FloatArray>(n)
            for (ti in 0 until n) {
                val si = match[ti]
                val tn = targetNodes[ti]
                val p = tn.parentIdx
                if (si >= 0) {
                    // мировой свинг источника, развёрнутый в систему координат цели,
                    // применяется СЛЕВА: tgtGlobal = S * tgtBind
                    val sq = source.globalQ(f, si)
                    val delta = Math3D.qMul(sq, Math3D.qConj(source.bindGlobalQ[si]))
                    val deltaT = Math3D.qMul(Math3D.qMul(Qfix, delta), Math3D.qConj(Qfix))
                    gq[ti] = Math3D.qNorm(Math3D.qMul(deltaT, tn.bindGlobalQ))
                } else if (p < 0) {
                    gq[ti] = tn.bindGlobalQ.copyOf()
                } else {
                    // кость без пары едет с АНИМИРОВАННЫМ родителем
                    val ltb = Math3D.qMul(Math3D.qConj(targetNodes[p].bindGlobalQ), tn.bindGlobalQ)
                    gq[ti] = Math3D.qNorm(Math3D.qMul(gq[p]!!, ltb))
                }
                // мировые позиции
                if (ti == targetRootIdx) {
                    val srcRoot = source.rootPos(f)
                    var pos = Math3D.vAdd(rootT.bindGlobalT,
                        Math3D.qRot(Qfix, Math3D.vScale(Math3D.vSub(srcRoot, source.bindRootPos), scale)))
                    if (opt.inPlace) {
                        pos = floatArrayOf(rootT.bindGlobalT[0], pos[1], rootT.bindGlobalT[2])
                    }
                    gt[ti] = pos
                    rootPosOut[f] = pos
                } else {
                    gt[ti] = Math3D.vAdd(gt[p]!!, Math3D.qRot(gq[p]!!, tn.lclT))
                }
            }
            // локальные кватернионы — относительно АНИМИРОВАННОГО родителя (не bind!)
            for (ti in 0 until n) {
                val p = targetNodes[ti].parentIdx
                localQOut[f][ti] = if (p < 0) gq[ti]!!
                    else Math3D.qNorm(Math3D.qMul(Math3D.qConj(gq[p]!!), gq[ti]!!))
            }
            // groundFit: самая низкая точка стоп (нужны все кадры) — сохраняем
            if (opt.groundFit) {
                groundLowest[f] = lowestFootY(targetNodes, gq, gt)
            }
        }

        if (opt.groundFit) {
            val gLow = groundLowest.slice(0 until frames).minOrNull() ?: 0f
            val bindLow = lowestFootBind(targetNodes)
            val dy = bindLow - gLow
            for (f in 0 until frames) rootPosOut[f][1] += dy
        }

        return Result(
            jointNames = targetNodes.map { it.name },
            parentIdx = IntArray(n) { targetNodes[it].parentIdx },
            offsets = Array(n) { targetNodes[it].lclT.copyOf() },
            rootPos = rootPosOut,
            localQ = localQOut,
            notes = notes
        )
    }

    /** Угол разлёта рук в bind-позе: >115° — A-pose, 70..115° — T-pose. */
    private fun armSpread(names: List<String>, bindT: List<FloatArray>): Float? {
        var armIdx = -1; var parentIdx = -1
        for (i in names.indices) {
            if (normalize(names[i]) == "SLarm") {
                armIdx = i
                // родитель по имени не найти — ищем через TNode снаружи; тут приближённо:
                // плечо — ближайшая кость выше по цепочке, поэтому берём позицию плеча из пары
                break
            }
        }
        if (armIdx < 0) return null
        // ищем родителя: кость, чья позиция совпадает с началом руки и не совпадает с самой рукой
        var best = -1; var bestD = Float.MAX_VALUE
        for (i in names.indices) {
            if (i == armIdx) continue
            val d = Math3D.vLen(Math3D.vSub(bindT[i], bindT[armIdx]))
            if (d > 1e-5f && d < bestD) { bestD = d; best = i }
        }
        if (best < 0) return null
        val dir = Math3D.vNorm(Math3D.vSub(bindT[armIdx], bindT[best]))
        val ang = Math.toDegrees(kotlin.math.acos(Math3D.vDot(dir, floatArrayOf(0f, 1f, 0f)).coerceIn(-1f, 1f)).toDouble())
        return ang.toFloat()
    }

    private fun poseNote(label: String, names: List<String>, bindT: List<FloatArray>): String {
        val a = armSpread(names, bindT)
        return when {
            a == null -> "$label: руки не найдены"
            a > 150f -> "$label: узкая поза (руки почти вертикально, ~${"%.0f"}° от вертикали)".format(a)
            a > 115f -> "$label: A-pose (руки ~${"%.0f"}° от вертикали)".format(a)
            a > 70f -> "$label: T-pose (руки ~${"%.0f"}° от вертикали)".format(a)
            else -> "$label: руки выше горизонтали (~${"%.0f"}° от вертикали)".format(a)
        }
    }

    private fun upHint(names: List<String>, bindT: List<FloatArray>): FloatArray? {
        var hips = -1; var head = -1
        for (i in names.indices) {
            when (normalize(names[i])) {
                "hips" -> hips = i
                "head" -> head = i
            }
        }
        if (hips < 0 || head < 0) return null
        val v = Math3D.vSub(bindT[head], bindT[hips])
        return if (Math3D.vLen(v) < 1e-6f) null else Math3D.vNorm(v)
    }

    private fun targetLegLength(nodes: List<TNode>): Float {
        var sum = 0f; var found = 0
        for (t in nodes) {
            val n = normalize(t.name)
            if (n.endsWith("upleg") || n == "Sleg" || n.endsWith("leg")) { sum += Math3D.vLen(t.lclT); found++ }
        }
        return if (found >= 4) sum / 2f else 0f
    }

    private fun lowestFootY(nodes: List<TNode>, gq: Array<FloatArray?>, gt: Array<FloatArray?>): Float {
        var low = Float.MAX_VALUE
        for (i in nodes.indices) {
            val n = normalize(nodes[i].name)
            if (n.endsWith("foot") || n.endsWith("toe")) low = min(low, gt[i]!![1])
        }
        return if (low == Float.MAX_VALUE) 0f else low
    }

    private fun lowestFootBind(nodes: List<TNode>): Float {
        var low = Float.MAX_VALUE
        for (t in nodes) {
            val n = normalize(t.name)
            if (n.endsWith("foot") || n.endsWith("toe")) low = min(low, t.bindGlobalT[1])
        }
        return if (low == Float.MAX_VALUE) 0f else low
    }
}
