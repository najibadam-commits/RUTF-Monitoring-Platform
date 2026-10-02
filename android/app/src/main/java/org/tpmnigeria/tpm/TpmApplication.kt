package org.tpmnigeria.tpm

import android.app.Application
import androidx.work.Configuration
import org.tpmnigeria.tpm.data.AppRepository
import org.tpmnigeria.tpm.data.ReferenceRepository
import org.tpmnigeria.tpm.data.StockRepository
import org.tpmnigeria.tpm.data.local.TpmDatabase
import org.tpmnigeria.tpm.session.AppSession
import org.tpmnigeria.tpm.sync.SyncScheduler
import org.tpmnigeria.tpm.sync.SyncWorkerFactory
import org.osmdroid.config.Configuration as OsmConfiguration

/**
 * Composition root. No DI framework — the app is small enough that a hand-rolled container on
 * Application keeps things simple and legible; reach for Hilt if this grows past a handful of
 * screens' worth of dependencies.
 */
class TpmApplication : Application(), Configuration.Provider {

    val database: TpmDatabase by lazy { TpmDatabase.getInstance(this) }
    val repository: AppRepository by lazy {
        AppRepository(
            database.issueDao(), database.notificationDao(), database.syncQueueDao(),
            database.issueIdCounterDao(), database.attendanceDao(), this,
        )
    }
    val referenceRepository: ReferenceRepository by lazy { ReferenceRepository(database.referenceDao(), this) }
    val session: AppSession by lazy { AppSession(this, referenceRepository) }
    val stockRepository: StockRepository by lazy { StockRepository(database.stockDao(), database.syncQueueDao(), this) }

    override fun onCreate() {
        super.onCreate()
        // No more demo seeding — Room's issues table is populated by the real pull-sync against
        // Supabase (AppRepository.pullRemoteIssues, triggered on login and periodically; see
        // SyncScheduler) rather than fake sample data.
        SyncScheduler.schedulePeriodic(this)

        // osmdroid requires a distinct user agent (OSM tile usage policy) and a configured cache
        // path — set once here rather than per-MapScreen-visit. See MapScreen.kt. Cache lives
        // under the app-private cache dir so no storage permission is needed.
        val osm = OsmConfiguration.getInstance()
        osm.load(this, getSharedPreferences("osmdroid", MODE_PRIVATE))
        osm.userAgentValue = packageName
        osm.osmdroidBasePath = java.io.File(cacheDir, "osmdroid").apply { mkdirs() }
        osm.osmdroidTileCache = java.io.File(osm.osmdroidBasePath, "tiles").apply { mkdirs() }
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(SyncWorkerFactory(repository, session, stockRepository))
            .build()
}
