/** Parent-only ownership, bound to already-versioned state publication.
 * No generations or functions need to be added to protocol v1. */
export class ViewAuthorization {
  private owners = new Map<
    string,
    { token: string; minimumRevision: number }
  >();
  update(
    current: Readonly<Record<string, string>> | undefined,
    revision: number,
  ): boolean {
    let changed = false;
    for (const id of this.owners.keys()) {
      if (!current || !Object.hasOwn(current, id)) {
        this.owners.delete(id);
        changed = true;
      }
    }
    for (const [id, token] of Object.entries(current ?? {})) {
      if (this.owners.get(id)?.token === token) continue;
      this.owners.set(id, {
        token,
        minimumRevision: revision === 0 ? 0 : revision + 1,
      });
      changed = true;
    }
    return changed;
  }
  allows(id: string, observedRevision: number): boolean {
    const owner = this.owners.get(id);
    return !owner || observedRevision >= owner.minimumRevision;
  }
}
