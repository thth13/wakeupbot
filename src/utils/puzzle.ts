interface Puzzle {
  question: string;
  correctAnswer: number;
  options: number[];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generatePuzzle(): Puzzle {
  const op = ['+', '-', '*'][randInt(0, 2)];
  let a: number;
  let b: number;
  let correct: number;

  if (op === '+') {
    a = randInt(5, 20);
    b = randInt(1, 10);
    correct = a + b;
  } else if (op === '-') {
    a = randInt(10, 20);
    b = randInt(1, a); // ensure positive result
    correct = a - b;
  } else {
    a = randInt(2, 9);
    b = randInt(2, 9);
    correct = a * b;
  }

  const question = `${a} ${op} ${b} = ?`;

  // Generate 3 unique wrong answers close to the correct one
  const wrongSet = new Set<number>();
  while (wrongSet.size < 3) {
    const delta = randInt(-5, 5);
    const candidate = correct + delta;
    if (candidate !== correct && candidate >= 0) {
      wrongSet.add(candidate);
    }
  }

  const options = shuffle([correct, ...Array.from(wrongSet)]);

  return { question, correctAnswer: correct, options };
}
