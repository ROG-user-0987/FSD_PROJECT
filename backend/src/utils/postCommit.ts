// Collects side effects (socket events) during a database transaction and runs them
// only after the transaction has committed. If the transaction rolls back, nothing is
// sent, so clients never hear about changes that did not happen.
import { logger } from '../config/logger.js'

export class PostCommit {
  private readonly tasks: (() => void)[] = []

  add(task: () => void) {
    this.tasks.push(task)
  }

  flush() {
    for (const task of this.tasks) {
      try {
        task()
      } catch (err) {
        logger.error({ err }, 'Post-commit task failed')
      }
    }
    this.tasks.length = 0
  }
}
