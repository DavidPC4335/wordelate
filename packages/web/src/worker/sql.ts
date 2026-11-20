/** The few statements the board needs. D1 and the tests both satisfy this. */
export type Sql = {
  get<T extends Record<string, unknown>>(statement: string, params: readonly unknown[]): Promise<T | null>;
  all<T extends Record<string, unknown>>(statement: string, params: readonly unknown[]): Promise<T[]>;
  run(statement: string, params: readonly unknown[]): Promise<number>;
};
