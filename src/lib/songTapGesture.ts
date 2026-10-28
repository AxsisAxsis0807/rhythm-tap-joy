export class SongTapGesture {
  private down: { id: number; type: string; x: number; y: number; time: number } | null = null;
  private last: { type: string; x: number; y: number; time: number } | null = null;
  reset() {
    this.down = null;
    this.last = null;
  }
  start(id: number, type: string, primary: boolean, x: number, y: number, time: number) {
    if (!primary || this.down) {
      this.reset();
      return;
    }
    this.down = { id, type, x, y, time };
  }
  move(id: number, x: number, y: number) {
    if (this.down?.id === id && Math.hypot(x - this.down.x, y - this.down.y) > 8) this.reset();
  }
  end(id: number, x: number, y: number, time: number): "none" | "select" | "play" {
    const down = this.down;
    this.down = null;
    if (
      !down ||
      down.id !== id ||
      time - down.time > 350 ||
      Math.hypot(x - down.x, y - down.y) > 8
    ) {
      this.reset();
      return "none";
    }
    const previous = this.last;
    this.last = { type: down.type, x, y, time };
    if (
      previous &&
      previous.type === down.type &&
      time - previous.time <= 350 &&
      Math.hypot(x - previous.x, y - previous.y) <= 12
    ) {
      this.reset();
      return "play";
    }
    return "select";
  }
  get active() {
    return this.down !== null;
  }
}
