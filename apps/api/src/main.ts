import { createApp } from './app/app.js';

const app = createApp();
const port = Number(process.env.PORT ?? 3333);

app.listen(port, () => {
  console.log(`Movie Recommender API running at http://localhost:${port}`);
});
