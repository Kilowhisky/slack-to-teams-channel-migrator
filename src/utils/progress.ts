export class Progress {
  private current = 0;
  private total: number;
  private label: string;

  constructor(label: string, total: number) {
    this.label = label;
    this.total = total;
  }

  increment(): void {
    this.current++;
    this.print();
  }

  setTotal(total: number): void {
    this.total = total;
  }

  private print(): void {
    const pct = this.total > 0 ? Math.round((this.current / this.total) * 100) : 0;
    process.stdout.write(
      `\r[${this.current}/${this.total}] ${this.label}... ${pct}%`
    );
    if (this.current >= this.total) {
      process.stdout.write("\n");
    }
  }

  done(): void {
    process.stdout.write("\n");
  }
}
