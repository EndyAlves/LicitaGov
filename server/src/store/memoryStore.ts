import type { Process, User } from '../domain/types.js';

/** Persistência em memória. O serviço só depende destes métodos: trocar por um banco não afeta o domínio. */
export class MemoryStore {
  private users = new Map<string, User>();
  private processes = new Map<string, Process>();
  private seq = 0;

  constructor(seed: { users?: User[] } = {}) {
    seed.users?.forEach((u) => this.users.set(u.id, structuredClone(u)));
  }

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  listUsers(): User[] {
    return [...this.users.values()];
  }

  getProcess(id: string): Process | undefined {
    return this.processes.get(id);
  }

  listProcesses(): Process[] {
    return [...this.processes.values()];
  }

  saveProcess(p: Process): void {
    this.processes.set(p.id, p);
  }
}
