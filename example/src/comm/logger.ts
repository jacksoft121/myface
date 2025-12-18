// A simple performance logger that can be enabled/disabled.

// The __DEV__ global variable is true in development and false in production.
const LOG_ENABLED = __DEV__;

/**
 * Measures the execution time of a function and logs it to the console if logging is enabled.
 *
 * @param label - A descriptive label for the performance measurement.
 * @param work - The function to be executed and measured.
 * @returns The result of the work function.
 */
export function logPerformance<T>(label: string, work: () => T): T {
  "worklet"; // Add worklet directive
  if (!LOG_ENABLED) {
    return work();
  }

  const start = performance.now();
  const result = work();
  const end = performance.now();
  console.log(`[Performance] ${label}: ${end - start}ms`);
  return result;
}

/**
 * Logs a message to the console if logging is enabled.
 *
 * @param messages - The messages to be logged.
 */
export function log(...messages: any[]) {
  "worklet"; // Add worklet directive
  if (LOG_ENABLED) {
    console.log(...messages);
  }
}
