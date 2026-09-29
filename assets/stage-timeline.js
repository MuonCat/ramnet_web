'use strict';

class StageTimeline {
  constructor(root, seek) {
    this.root = root;
    this.seek = seek;
    this.track = document.createElement('div');
    this.track.className = 'stage-timeline';
    this.segments = document.createElement('div');
    this.segments.className = 'stage-timeline-segments';
    this.input = document.createElement('input');
    this.input.type = 'range';
    this.input.className = 'stage-timeline-seek';
    this.input.min = 0;
    this.input.max = 10000;
    this.input.step = 1;
    this.input.setAttribute('aria-label', 'Animation stages and progress');
    this.marker = document.createElement('span');
    this.marker.className = 'stage-timeline-marker';
    this.marker.setAttribute('aria-hidden', 'true');
    this.track.append(this.segments, this.input, this.marker);
    root.append(this.track);
    this.input.addEventListener('input', () => seek(this.timeAt(Number(this.input.value) / 10000)));
    const syncMode = () => { this.input.disabled = window.ramnetCompactInteractions.matches; };
    window.ramnetCompactInteractions.addEventListener('change', syncMode);
    syncMode();
  }

  setStages(stages) {
    this.total = stages.reduce((sum, stage) => sum + stage.duration, 0);
    let start = 0, left = 0;
    this.stages = stages.map(stage => {
      // Blend equal widths with true durations so short stages still fit their labels.
      const width = .65 / stages.length + .35 * stage.duration / this.total;
      const entry = {...stage, start, left, width};
      start += stage.duration;
      left += width;
      return entry;
    });
    this.segments.replaceChildren();
    this.buttons = this.stages.map(stage => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stage-timeline-step';
      button.style.flex = `0 0 ${stage.width * 100}%`;
      button.title = stage.description || stage.label;
      const label = document.createElement('span');
      label.textContent = stage.label;
      button.append(label);
      button.addEventListener('click', () => this.seek(stage.start));
      this.segments.append(button);
      return button;
    });
  }

  timeAt(position) {
    position = Math.max(0, Math.min(1, position));
    const stage = this.stages.find(stage => position < stage.left + stage.width) || this.stages.at(-1);
    return Math.min(this.total, stage.start + (position - stage.left) / stage.width * stage.duration);
  }

  update(time) {
    time = Math.max(0, Math.min(this.total, time));
    const index = this.stages.findIndex(stage => time < stage.start + stage.duration);
    const active = index < 0 ? this.stages.length - 1 : index;
    const stage = this.stages[active];
    const fraction = (time - stage.start) / stage.duration;
    const position = stage.left + fraction * stage.width;
    this.input.value = position * 10000;
    this.input.setAttribute('aria-valuetext', `${stage.label}, ${time.toFixed(1)} of ${this.total.toFixed(1)} seconds`);
    this.input.title = stage.description || stage.label;
    this.marker.style.left = `${position * 100}%`;
    this.buttons.forEach((button, index) => {
      button.style.setProperty('--stage-progress', `${(index < active ? 1 : index === active ? fraction : 0) * 100}%`);
      button.setAttribute('aria-current', index === active ? 'step' : 'false');
    });
  }
}
