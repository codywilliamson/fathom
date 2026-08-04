import { sharedDb } from './db'
import { startScanner } from './scanner'
import { startRateLimitPoller } from './ratelimit'
import { startServer } from './server'

sharedDb() // open + migrate before anything reads
startScanner()
startRateLimitPoller()
startServer()
