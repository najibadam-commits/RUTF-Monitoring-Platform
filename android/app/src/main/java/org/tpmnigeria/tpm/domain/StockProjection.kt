package org.tpmnigeria.tpm.domain

/**
 * What the facility holds right now as far as this device knows: the ledger balance from the last
 * sync, plus the effect of submissions still waiting in the sync queue. The server stays the
 * source of truth — this is only so My Stock and the Stock Count review make sense offline.
 *
 * Dispensing has no lot until the server allocates it (earliest expiry first, DECISIONS R22), so
 * pending dispensing is kept as a separate total rather than guessed onto a lot.
 */
data class LotPosition(
    val lotKey: String,
    val lotId: String?,
    val lotNo: String?,
    val expiryDate: String?,
    val synced: Int,
    val pending: Int,
) {
    val projected: Int get() = synced + pending
}

data class StockPosition(
    val lots: List<LotPosition>,
    val pendingDispensed: Int,
    val pendingSubmissions: Int,
) {
    val total: Int get() = lots.sumOf { it.projected } - pendingDispensed
}

data class SyncedBalance(val lotKey: String, val lotId: String?, val balance: Int)
data class LotInfo(val lotNo: String, val expiryDate: String)

fun projectStock(
    synced: List<SyncedBalance>,
    lots: Map<String, LotInfo>,
    pending: List<LedgerSubmission>,
): StockPosition {
    val positions = linkedMapOf<String, LotPosition>()
    for (b in synced) {
        val info = b.lotId?.let(lots::get)
        positions[b.lotKey] = LotPosition(b.lotKey, b.lotId, info?.lotNo, info?.expiryDate, b.balance, 0)
    }
    fun bump(line: LedgerLine, delta: Int) {
        val key = line.lotKey
        val existing = positions[key]
        positions[key] = existing?.copy(pending = existing.pending + delta) ?: run {
            val info = line.lotId?.let(lots::get)
            LotPosition(key, line.lotId, info?.lotNo ?: line.lotNo, info?.expiryDate ?: line.expiryDate, 0, delta)
        }
    }

    var pendingDispensed = 0
    for (s in pending) when (s.kind) {
        LedgerKind.Receipt -> s.lines.forEach { bump(it, it.quantity - it.damaged) }
        LedgerKind.Issue -> s.lines.forEach { bump(it, -it.quantity) }
        LedgerKind.Dispensing -> pendingDispensed += s.sachetsDispensed
        LedgerKind.Loss -> s.lines.forEach { bump(it, if (s.lossType == "adjustment") it.quantity else -it.quantity) }
        // The server turns a count into an adjustment that brings the ledger to the count.
        LedgerKind.StockCount -> s.lines.forEach { line ->
            val current = positions[line.lotKey]?.projected ?: 0
            bump(line, line.quantity - current)
        }
    }
    return StockPosition(
        lots = positions.values.sortedWith(compareBy<LotPosition> { it.expiryDate ?: "9999" }.thenBy { it.lotNo ?: "" }),
        pendingDispensed = pendingDispensed,
        pendingSubmissions = pending.size,
    )
}

/** Cartons + loose sachets -> sachets (the app always records sachets; brief §8). */
fun toSachets(cartons: Int, loose: Int, unitsPerCarton: Int): Int = cartons * unitsPerCarton + loose
