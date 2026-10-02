package org.tpmnigeria.tpm.sync

import android.content.Context
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import org.tpmnigeria.tpm.data.AppRepository
import org.tpmnigeria.tpm.data.StockRepository
import org.tpmnigeria.tpm.session.AppSession

/** Hands SyncWorker the app's [AppRepository]/[AppSession] instead of letting WorkManager
 *  reflectively construct it — see TpmApplication's Configuration.Provider override. */
class SyncWorkerFactory(
    private val repository: AppRepository,
    private val session: AppSession,
    private val stockRepository: StockRepository,
) : WorkerFactory() {
    override fun createWorker(
        appContext: Context,
        workerClassName: String,
        workerParameters: WorkerParameters,
    ) = when (workerClassName) {
        SyncWorker::class.java.name ->
            SyncWorker(appContext, workerParameters, repository, SupabaseSyncApiService(repository, session, stockRepository))
        else -> null
    }
}
