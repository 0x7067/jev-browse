const app = document.querySelector('#app');

const scenario = new URL(location.href).searchParams.get('scenario') || 'setup';

if (scenario === 'setup' || scenario === 'challenge') {
  app.innerHTML = '<h1>Practice quiz</h1><button id="open">Start quiz</button><dialog aria-label="Set up your quiz"><h2>Set up your quiz</h2><p>Choose a question count, then start.</p><div id="counts"></div><button id="start">Start quiz</button><button id="close">Close</button><output></output></dialog>';
  const dialog = app.querySelector('dialog');

  for (let i = 1; i <= 14; i++) {
    const button = document.createElement('button');
    button.textContent = String(i);
    document.querySelector('#counts').append(button);
  }

  document.querySelector('#open').onclick = () => dialog.showModal();
  document.querySelector('#close').onclick = () => dialog.close();
  document.querySelector('#start').onclick = () => {
    if (scenario === 'setup') {
      dialog.close();
      app.innerHTML = '<h1>Question 1</h1><p>Which planet is known as the red planet?</p><button>Mars</button><button>Venus</button>';
    } else {
      const output = dialog.querySelector('output');
      output.className = 'cf-chl-verification';
      output.textContent = 'Please complete verification to continue.';
      output.setAttribute('data-sitekey', 'fixture');
    }
  };
} else if (scenario === 'hidden-challenge') {
  app.innerHTML = '<h1>Public article</h1><p>Article ready to read.</p><div class="cf-chl-verification" hidden>Please complete verification.</div>';
} else if (scenario === 'frames') {
  app.innerHTML = '<h1>Preview gallery</h1><p>Wait until both previews report loaded.</p><section aria-label="Preview A" data-loaded="false"><iframe title="Preview A"></iframe></section><section aria-label="Preview B" data-loaded="false"><iframe title="Preview B" sandbox=""></iframe></section>';

  for (const [index, frame] of [...document.querySelectorAll('iframe')].entries()) {
    setTimeout(() => {
      frame.onload = () => { frame.parentElement.dataset.loaded = 'true'; };

      frame.srcdoc = '<h1>Preview content ready</h1>';
    }, 1800 + index * 1800);
  }
} else if (scenario === 'anchors') {
  app.innerHTML = '<h1>Certification guide</h1><h2 id="foundations">Foundations <a href="#foundations">#</a></h2><p>Foundation study guide.</p><h2 id="developer">Developer <a href="#developer">#</a></h2><p>Developer study guide.</p>';
}

if (scenario === 'anchors') {
  for (const anchor of document.querySelectorAll('a')) {
    anchor.onclick = () => {
      anchor.classList.add('copied');
      setTimeout(() => anchor.classList.remove('copied'), 250);
    };
  }
}
