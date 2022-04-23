console.info(
  `%c  JELLYFIN-NEXT-UP-CARD  \n%c      Version 1.0.0      `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray'
);

class JellyfinNextUpCard extends HTMLElement {
  static getStubConfig() {
    return {
      sensor: '',
      include_resume: true,
      resume_sensor: '',
      show_thumbnails: false,
      jellyfin_host: '',
      default_player: 'web',
      roku_entity_id: '',
      hide_play_button: false,
      show_runtime: true
    }
  }
  // Whenever the state changes, a new `hass` object is set. Use this to
  // update your content.
  set hass(hass) {
    // Initialize the content if it's not there yet.
    if (!this.content) {
      this.innerHTML = `
        <ha-card header="Jellyfin: ${this.config.include_resume ? 'Continue Watching / ' : ''}Next Up">
          <div class="card-content"></div>
        </ha-card>
      `;
      this.content = this.querySelector('div');

      // globalize the playEpisode handler
      // there's definitely a better way to do this but meh
      window.playJellyfinEpisode = this.playEpisode.bind(this);
    }

    this._hass = hass;
    this.render(hass);
  }

  render(hass) {
    const sensorId = this.config.sensor;
    const state = hass.states[sensorId];
    if (!state?.attributes?.Items) {
      this.content.innerHTML = 'Unavailable';
      return;
    }
    let items = state.attributes.Items;

    if (this.config.include_resume) {
      const resumeSensorId = this.config.resume_sensor;
      const resumeState = hass.states[resumeSensorId];
      const resumeItems = resumeState.attributes.Items;

      if (resumeItems) {
        for (const rItem of resumeItems) {
          rItem._Type = 'resume';
        }
        items = resumeItems.concat(items);
      }
    }

    const itemsHTML = [];

    for (const item of items) {
      if (!item?.Name || !item.Id || !item.IndexNumber || !item.ParentIndexNumber || !item.SeriesName || !item.SeriesId) {
        continue;
      }

      let itemHtml = `<div class="episode${item._Type === 'resume' ? ' episode-resume' : ''}"`;

      if (this.config.show_thumbnails && this.config.jellyfin_host && item.ImageTags?.Primary) {
        const bgUrl = this.getThumbnailURL(item.Id, item.ImageTags.Primary)
        itemHtml += ` style="background-image: url('${bgUrl}');"`
      }

      itemHtml += `
        ><div class="episode-details" data-episode-id="${item.Id}">
        <div class="series-title" >${item.SeriesName}</div>
        <span class="episode-title">${item.Name}</span>
        • <span class="episode-number" >s${(item.ParentIndexNumber+'').padStart(2, '0')}e${(item.IndexNumber+'').padStart(2, '0')}</span>
      `;

      if (this.config.show_runtime && item.RunTimeTicks) {
        const runtime = this.getDisplayDuration(item.RunTimeTicks);
        itemHtml += `• <span class="episode-runtime">${runtime}</span>`;
      }

      if (!this.config.hide_play_button) {
        const rokuButton = `<br><button class="play-episode" onclick="playJellyfinEpisode('${item.Id}', 'roku')">
          <ha-icon icon="mdi:play"></ha-icon>
          ${item._Type === 'resume' ? 'Resume' : 'Play'} Episode on Roku
        </button>`;
        const webButton = `<br><button class="play-episode" onclick="playJellyfinEpisode('${item.Id}', 'web')">
          <ha-icon icon="mdi:play"></ha-icon>
          ${item._Type === 'resume' ? 'Resume' : 'Play'} Episode in Browser
        </button>`;
        if (this.config.default_player === 'roku') {
          itemHtml += rokuButton;
          if (this.config.jellyfin_host) {
            itemHtml += webButton;
          }
        } else {
          itemHtml += webButton;
          if (this.config.roku_entity_id) {
            itemHtml += rokuButton;
          }
        }
      }

      if (item._Type === 'resume' && item.UserData?.PlayedPercentage) {
        // add progress bar
        itemHtml += `</div>
          <div class="watched-progress-container">
            <div class="watched-progress" style="width: ${parseInt(item.UserData.PlayedPercentage)}%"></div>
          </div>
        </div>`;
      } else {
        itemHtml += '</div></div>';
      }

      itemsHTML.push(itemHtml);
    }

    itemsHTML.push(`<style>${JellyfinNextUpCard.getStyle()}</style>`);

    this.content.innerHTML = itemsHTML.join('');
    if (!this.config.hide_play_button) {
      this.addEventListeners();
    }
  }

  // The user supplied configuration. Throw an exception and Home Assistant
  // will render an error card.
  setConfig(config) {
    if (!config.sensor) {
      throw new Error('You need to define a Jellyfin REST sensor');
    }
    if (config.include_resume && !config.resume_sensor) {
      throw new Error('You need to define a resume_sensor to include shows to continue watching.');
    }
    if (config.show_thumbnails && !config.jellyfin_host) {
      throw new Error('You need to add your jellyfin_host in order to use show_thumbnails.');
    }
    if (!config.hide_play_button && !config.default_player) {
      throw new Error('You need to set your default_player in order to show the play button(s).');
    }
    if (config.default_player && !config.hide_play_button) {
      switch (config.default_player) {
        case 'roku': {
          if (!config.roku_entity_id) {
            throw new Error('You need to add your roku_entity_id to use a roku as the default_player.');
          }
          break;
        }
        case 'web': {
          if (!config.jellyfin_host) {
            throw new Error('You need to add your jellyfin_host to use Jellyfin Web as the default_player.');
          }
          break;
        }
        default:
          throw new Error('Invalid value for default_player. Supported values are "web" and "roku".');
      }
    }
    this.config = config;
  }

  // The height of your card. Home Assistant uses this to automatically
  // distribute all cards over the available columns.
  getCardSize() {
    return 69;
  }

  // convert runtime ticks to readable time (22m, 1h 30m etc.)
  // https://github.com/jellyfin/jellyfin-web/blob/227620452fa941cc97b6e5e1b54c28b9dfadb0e4/src/scripts/datetime.js#L64
  getDisplayDuration(ticks) {
    const totalMinutes = Math.round(ticks / 600000000) || 1;
    const totalHours = Math.floor(totalMinutes / 60);
    const remainderMinutes = totalMinutes % 60;
    const result = [];
    if (totalHours > 0) {
        result.push(`${totalHours}h`);
    }
    result.push(`${remainderMinutes}m`);
    return result.join(' ');
  }

  getThumbnailURL(episodeId, imageTag) {
    return `${this.config.jellyfin_host}/Items/${episodeId}/Images/Primary?tag=${imageTag}`;
  }

  playEpisode(episodeId, player) {
    if (!player || player === 'default') {
      player = this.config.default_player;
    }
    //console.log(this);
    switch (player) {
      case 'roku': {
        this._hass.callService('media_player', 'play_media', {
          entity_id: this.config.roku_entity_id,
          media_content_id: 592369,
          media_content_type: 'app',
          extra: {
            content_id: episodeId,
            media_type: 'episode'
          }
        });
        break;
      }
      case 'web': {
        window.open(`${this.config.jellyfin_host}/web/index.html#!/details?id=${episodeId}`);
        break;
      }
      default:
        alert('No value set for default_player.');
    }
  }

  addEventListeners() {
    const episodes = document.querySelectorAll('.episode-details');
    for (const episode of episodes) {
      episode.addEventListener('click', event => {
        const episodeId = event.target.dataset.episodeId;
        console.log({episodeId})
        return episodeId ? this.playEpisode(episodeId) : null;
      })
    }
  }

  static getStyle() {
    return `
      .episode {
        display: inline-block;
        height: 18em;
        width: 32em;
        margin: 1em;
        background-size: cover;
        border-radius: 1em;
        vertical-align: bottom;
      }
      .episode-details {
        background-color: rgba(0, 0, 0, 0.6);
        height: 16em;
        padding: 1em 2em;
        color: #ccc;
        text-shadow: 0 0 9px #000;
        border-radius: 1em;
        cursor: pointer;
      }
      .episode-resume > .episode-details {
        height: 15em;
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
      }
      .watched-progress-container {
        height: 1em;
        border-bottom-left-radius: 1em;
        border-bottom-right-radius: 1em;
        background-color: rgba(0, 0, 0, 0.75);
        overflow: hidden;
      }
      .watched-progress {
        height: 1em;
        background-color: var(--primary-color);
      }
      .series-title {
        font-size: 2em;
        line-height: 1.5em;
        color: #fff;
      }
      .episode-title {
        color: #fff;
      }
      .play-episode {
        margin-top: 1em;
        background-color: rgba(255, 255, 255, 0.2);
        border: none;
        border-radius: 0.5em;
        z-index: 3;
        padding-right: 0.5em;
        cursor: pointer;
      }
      .play-episode:hover {
        background-color: rgba(255, 255, 255, 0.25);
      }
      .play-episode:active {
        background-color: rgba(255, 255, 255, 0.3);
      }
      @media screen and (max-width: 32em) {
        .episode {
          margin: 1em 0;
          width: 100%;
        }
        .episode-details {
          padding: 0.5em 1em;
          height: 17em;
        }
        .episode-resume > .episode-details {
          height: 16em;
        }
      }
    `;
  }
}

customElements.define('jellyfin-next-up-card', JellyfinNextUpCard);
