package com.retarget.app.bvh

/**
 * Текстовый парсер BVH (в т.ч. Mixamo: каналы ZXY, сантиметры).
 */
object BvhParser {

    fun parse(text: String): Bvh {
        val toks = tokenize(text)
        var i = 0
        fun next(): String = toks[i++]

        fun expect(s: String) {
            val t = next()
            if (!t.equals(s, ignoreCase = true)) throw IllegalArgumentException("BVH: ожидалось '$s', найдено '$t'")
        }

        fun parseJoint(isRoot: Boolean): BvhJoint {
            expect(if (isRoot) "ROOT" else "JOINT")
            val name = next()
            expect("{")
            expect("OFFSET")
            val off = floatArrayOf(next().toFloat(), next().toFloat(), next().toFloat())
            expect("CHANNELS")
            val n = next().toInt()
            val chans = (0 until n).map { next() }
            val j = BvhJoint(name, off, chans)
            j.isRoot = isRoot
            while (i < toks.size && toks[i].equals("JOINT", ignoreCase = true)) {
                val c = parseJoint(false)
                c.parent = j; j.children.add(c)
            }
            if (i < toks.size && toks[i].equals("End", ignoreCase = true)) {
                next() // "End"
                next() // "Site"
                expect("{"); expect("OFFSET")
                next(); next(); next()
                expect("}")
            }
            expect("}")
            return j
        }

        expect("HIERARCHY")
        val root = parseJoint(true)

        expect("MOTION")
        expect("Frames:")
        val frames = next().toInt()
        expect("Frame")
        expect("Time:")
        val ft = next().toFloat()

        val totalChannels = root.let { r -> var s = 0; fun rec(j: BvhJoint) { s += j.channels.size; j.children.forEach { rec(it) } }; rec(r); s }
        val motion = Array(frames) { FloatArray(totalChannels) }
        for (f in 0 until frames) {
            for (k in 0 until totalChannels) motion[f][k] = next().toFloat()
        }
        return Bvh(root, ft, frames, motion)
    }

    private fun tokenize(text: String): List<String> {
        val out = ArrayList<String>(text.length / 6)
        for (line in text.lineSequence()) {
            for (t in line.trim().split(Regex("\\s+"))) if (t.isNotEmpty()) out.add(t)
        }
        return out
    }
}
