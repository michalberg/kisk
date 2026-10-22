import '../styles/base.css';
import '../styles/slides.css';
import '../styles/screen.css';
import { backend } from '../lib/backend';
import { audienceUrl, slides } from '../lib/deck';
import { morph } from '../lib/morph';
import { renderSlide } from '../lib/render';
import { createStore, type Store } from '../lib/store';

const stage = document.getElementById('stage')!;
const status = document.getElementById('status')!;
const url = audienceUrl();

function draw(st: Store) {
  status.hidden = st.connected;
  if (!st.state) return;
  const i = st.state.slide_index;
  const html =
    renderSlide(slides[i], {
      state: st.state,
      counts: st.counts,
      results: st.results,
      audienceUrl: url,
      index: i,
      total: slides.length,
    }) + '<div class="blackout"></div>';
  morph(stage, html);
  stage.classList.toggle('is-black', st.state.blackout);
}

createStore({ fetchResults: qid => backend.getResults(qid), onChange: draw });

// Double click toggles fullscreen (handy on the projector laptop).
document.addEventListener('dblclick', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});
