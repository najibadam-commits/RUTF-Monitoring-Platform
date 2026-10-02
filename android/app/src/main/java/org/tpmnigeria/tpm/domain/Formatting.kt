package org.tpmnigeria.tpm.domain

/** Matches the prototype's `fmtCoords`: `lat.toFixed(5) + '° N, ' + lng.toFixed(5) + '° E'`. */
fun formatCoords(lat: Double, lng: Double): String = "%.5f° N, %.5f° E".format(lat, lng)
