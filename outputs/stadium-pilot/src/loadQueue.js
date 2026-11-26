// Очередь второстепенных загрузок. Сначала грузится то, без чего нет первого кадра (обычные загрузчики Three.js),
// и только после start() очередь по одной берёт задачи: чем меньше priority, тем раньше. Так крупное (видео, чёткое небо)
// не отнимает канал у моделей и текстур, а на медленной сети всё приходит по важности.
export function createLoadQueue() {
  const pending = [];
  let started = false;
  let busy = false;

  const idle = () => new Promise((resolve) => {
    if (window.requestIdleCallback) window.requestIdleCallback(resolve, { timeout: 500 });
    else setTimeout(resolve, 60);
  });

  async function pump() {
    if (!started || busy) return;
    busy = true;
    while (pending.length) {
      await idle();
      pending.sort((a, b) => a.priority - b.priority);
      const { name, task, timeout } = pending.shift();
      try {
        // Зависшая загрузка не должна держать остальные: по таймауту идём дальше, сама она продолжается.
        await Promise.race([Promise.resolve(task()), new Promise((resolve) => setTimeout(resolve, timeout))]);
      } catch (error) {
        console.warn(`Фоновая загрузка не удалась: ${name}`, error);
      }
    }
    busy = false;
  }

  return {
    add(name, priority, task, { timeout = 12000 } = {}) {
      pending.push({ name, priority, task, timeout });
      pump();
    },
    start() {
      started = true;
      pump();
    },
  };
}
