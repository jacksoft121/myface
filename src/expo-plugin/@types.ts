/**
 * Configuration properties for the Expo plugin.
 * Contains settings that control the plugin's behavior.
 */
export type ConfigProps = {
  /**
   * Name of the model to be used by the plugin.
   * This specifies which face recognition model should be loaded.
   */
  modelName: string;
  /**
   * Optional directory path where model files are located, relative to project root.
   * If not specified, defaults to the project root directory.
   *
   * @example 'assets/models' - looks for models in <project-root>/assets/models/<modelName>
   * @default undefined (uses project root)
   */
  modelDir?: string;
};
