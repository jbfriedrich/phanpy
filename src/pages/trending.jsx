import '../components/links-bar.css';
import './trending.css';

import { MenuItem } from '@szhsin/react-menu';
import { getBlurHashAverageColor } from 'fast-blurhash';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import punycode from 'punycode/';
import { useNavigate, useParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';

import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import Menu2 from '../components/menu2';
import RelativeTime from '../components/relative-time';
import Timeline from '../components/timeline';
import { api } from '../utils/api';
import { oklab2rgb, rgb2oklab } from '../utils/color-utils';
import { filteredItems } from '../utils/filters';
import pmem from '../utils/pmem';
import shortenNumber from '../utils/shorten-number';
import states from '../utils/states';
import { saveStatus } from '../utils/states';
import supports from '../utils/supports';
import useTitle from '../utils/useTitle';

const LIMIT = 20;
const TREND_CACHE_TIME = 10 * 60 * 1000; // 10 minutes

const fetchLinks = pmem(
  (masto) => {
    return masto.v1.trends.links.list().next();
  },
  {
    maxAge: TREND_CACHE_TIME,
  },
);

const fetchHashtags = pmem(
  (masto) => {
    return masto.v1.trends.tags.list().next();
  },
  {
    maxAge: TREND_CACHE_TIME,
  },
);

function fetchTrendsStatuses(masto) {
  if (supports('@pixelfed/trending')) {
    return masto.pixelfed.v2.discover.posts.trending.list({
      range: 'daily',
    });
  }
  return masto.v1.trends.statuses.list({
    limit: LIMIT,
  });
}

function fetchLinkList(masto, params) {
  return masto.v1.timelines.link.list(params);
}

function Trending({ columnMode, ...props }) {
  const snapStates = useSnapshot(states);
  const params = columnMode ? {} : useParams();
  const { masto, instance } = api({
    instance: props?.instance || params.instance,
  });
  const { masto: currentMasto, instance: currentInstance } = api();
  const title = `Trending (${instance})`;
  useTitle(title, `/:instance?/trending`);
  // const navigate = useNavigate();
  const latestItem = useRef();

  const sameCurrentInstance = instance === currentInstance;

  const [hashtags, setHashtags] = useState([]);
  const [links, setLinks] = useState([]);
  const trendIterator = useRef();

  async function fetchTrends(firstLoad) {
    console.log('fetchTrend', firstLoad);
    if (firstLoad || !trendIterator.current) {
      trendIterator.current = fetchTrendsStatuses(masto);

      // Get hashtags
      if (supports('@mastodon/trending-hashtags')) {
        try {
          // const iterator = masto.v1.trends.tags.list();
          const { value: tags } = await fetchHashtags(masto);
          console.log('tags', tags);
          if (tags?.length) {
            setHashtags(tags);
          }
        } catch (e) {
          console.error(e);
        }
      }

      // Get links
      if (supports('@mastodon/trending-links')) {
        try {
          const { value } = await fetchLinks(masto, instance);
          // 4 types available: link, photo, video, rich
          // Only want links for now
          const links = value?.filter?.((link) => link.type === 'link');
          console.log('links', links);
          if (links?.length) {
            setLinks(links);
          }
        } catch (e) {
          console.error(e);
        }
      }
    }
    const results = await trendIterator.current.next();
    let { value } = results;
    if (value?.length) {
      if (firstLoad) {
        latestItem.current = value[0].id;
      }

      // value = filteredItems(value, 'public'); // Might not work here
      value.forEach((item) => {
        saveStatus(item, instance);
      });
    }
    return {
      ...results,
      value,
    };
  }

  // Link mentions
  // https://github.com/mastodon/mastodon/pull/30381
  const [currentLinkMentionsLoading, setCurrentLinkMentionsLoading] =
    useState(false);
  const currentLinkMentionsIterator = useRef();
  const [currentLink, setCurrentLink] = useState(null);
  const hasCurrentLink = !!currentLink;
  const currentLinkRef = useRef();
  const supportsTrendingLinkPosts =
    sameCurrentInstance && supports('@mastodon/trending-hashtags');

  useEffect(() => {
    if (currentLink && currentLinkRef.current) {
      currentLinkRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [currentLink]);

  const prevCurrentLink = useRef();
  async function fetchLinkMentions(firstLoad) {
    if (firstLoad || !currentLinkMentionsIterator.current) {
      setCurrentLinkMentionsLoading(true);
      currentLinkMentionsIterator.current = fetchLinkList(masto, {
        url: currentLink,
      });
    }
    prevCurrentLink.current = currentLink;
    const results = await currentLinkMentionsIterator.current.next();
    let { value } = results;
    if (value?.length) {
      value = filteredItems(value, 'public');
      value.forEach((item) => {
        saveStatus(item, instance);
      });
    }
    if (prevCurrentLink.current === currentLink) {
      setCurrentLinkMentionsLoading(false);
    }
    return {
      ...results,
      value,
    };
  }

  async function checkForUpdates() {
    try {
      const results = await masto.v1.trends.statuses
        .list({
          limit: 1,
          // NOT SUPPORTED
          // since_id: latestItem.current,
        })
        .next();
      let { value } = results;
      value = filteredItems(value, 'public');
      if (value?.length && value[0].id !== latestItem.current) {
        latestItem.current = value[0].id;
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  const TimelineStart = useMemo(() => {
    return (
      <>
        {!!hashtags.length && (
          <div class="filter-bar expandable">
            <Icon icon="chart" class="insignificant" size="l" />
            {hashtags.map((tag, i) => {
              const { name, history } = tag;
              const total = history.reduce((acc, cur) => acc + +cur.uses, 0);
              return (
                <Link to={`/${instance}/t/${name}`} key={name}>
                  <span>
                    <span class="more-insignificant">#</span>
                    {name}
                  </span>
                  <span class="filter-count">{shortenNumber(total)}</span>
                </Link>
              );
            })}
          </div>
        )}
        {!!links.length && (
          <div class="links-bar">
            <header>
              <h3>Trending News</h3>
            </header>
            {links.map((link) => {
              const {
                authorName,
                authorUrl,
                blurhash,
                description,
                height,
                image,
                imageDescription,
                language,
                providerName,
                providerUrl,
                publishedAt,
                title,
                url,
                width,
              } = link;
              const domain = punycode.toUnicode(
                URL.parse(url)
                  .hostname.replace(/^www\./, '')
                  .replace(/\/$/, ''),
              );
              let accentColor;
              if (blurhash) {
                const averageColor = getBlurHashAverageColor(blurhash);
                const labAverageColor = rgb2oklab(averageColor);
                accentColor = oklab2rgb([
                  0.6,
                  labAverageColor[1],
                  labAverageColor[2],
                ]);
              }

              return (
                <div key={url}>
                  <a
                    ref={currentLink === url ? currentLinkRef : null}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class={
                      hasCurrentLink
                        ? currentLink === url
                          ? 'active'
                          : 'inactive'
                        : ''
                    }
                    style={
                      accentColor
                        ? {
                            '--accent-color': `rgb(${accentColor.join(',')})`,
                            '--accent-alpha-color': `rgba(${accentColor.join(
                              ',',
                            )}, 0.4)`,
                          }
                        : {}
                    }
                  >
                    <article>
                      <figure>
                        <img
                          src={image}
                          alt={imageDescription}
                          width={width}
                          height={height}
                          loading="lazy"
                        />
                      </figure>
                      <div class="article-body">
                        <header>
                          <div class="article-meta">
                            <span class="domain">{domain}</span>{' '}
                            {!!publishedAt && <>&middot; </>}
                            {!!publishedAt && (
                              <>
                                <RelativeTime
                                  datetime={publishedAt}
                                  format="micro"
                                />
                              </>
                            )}
                          </div>
                          {!!title && (
                            <h1
                              class="title"
                              lang={language}
                              dir="auto"
                              title={title}
                            >
                              {title}
                            </h1>
                          )}
                        </header>
                        {!!description && (
                          <p
                            class="description"
                            lang={language}
                            dir="auto"
                            title={description}
                          >
                            {description}
                          </p>
                        )}
                      </div>
                    </article>
                  </a>
                  {supportsTrendingLinkPosts && (
                    <button
                      type="button"
                      class="small plain4 block"
                      onClick={() => {
                        setCurrentLink(url);
                      }}
                      disabled={url === currentLink}
                    >
                      <Icon icon="comment2" /> <span>Mentions</span>{' '}
                      <Icon icon="chevron-down" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {supportsTrendingLinkPosts && !!links.length && (
          <div
            class={`timeline-header-block ${hasCurrentLink ? 'blended' : ''}`}
          >
            {hasCurrentLink ? (
              <>
                <div style={{ width: 50, flexShrink: 0, textAlign: 'center' }}>
                  {currentLinkMentionsLoading ? (
                    <Loader abrupt />
                  ) : (
                    <button
                      type="button"
                      class="light"
                      onClick={() => {
                        setCurrentLink(null);
                      }}
                    >
                      <Icon icon="x" />
                    </button>
                  )}
                </div>
                <p>
                  Showing posts mentioning{' '}
                  <span class="link-text">
                    {currentLink
                      .replace(/^https?:\/\/(www\.)?/i, '')
                      .replace(/\/$/, '')}
                  </span>
                </p>
              </>
            ) : (
              <p class="insignificant">Trending posts</p>
            )}
          </div>
        )}
      </>
    );
  }, [hashtags, links, currentLink, currentLinkMentionsLoading]);

  return (
    <Timeline
      key={instance}
      title={title}
      titleComponent={
        <h1 class="header-double-lines">
          <b>Trending</b>
          <div>{instance}</div>
        </h1>
      }
      id="trending"
      instance={instance}
      emptyText="No trending posts."
      errorText="Unable to load posts"
      fetchItems={hasCurrentLink ? fetchLinkMentions : fetchTrends}
      checkForUpdates={hasCurrentLink ? undefined : checkForUpdates}
      checkForUpdatesInterval={5 * 60 * 1000} // 5 minutes
      useItemID
      headerStart={<></>}
      boostsCarousel={snapStates.settings.boostsCarousel}
      // allowFilters
      filterContext="public"
      timelineStart={TimelineStart}
      refresh={currentLink}
      clearWhenRefresh
      view={hasCurrentLink ? 'link-mentions' : undefined}
      headerEnd={
        <Menu2
          portal
          // setDownOverflow
          overflow="auto"
          viewScroll="close"
          position="anchor"
          menuButton={
            <button type="button" class="plain">
              <Icon icon="more" size="l" />
            </button>
          }
        >
          <MenuItem
            onClick={() => {
              let newInstance = prompt(
                'Enter a new instance e.g. "mastodon.social"',
              );
              if (!/\./.test(newInstance)) {
                if (newInstance) alert('Invalid instance');
                return;
              }
              if (newInstance) {
                newInstance = newInstance.toLowerCase().trim();
                // navigate(`/${newInstance}/trending`);
                location.hash = `/${newInstance}/trending`;
              }
            }}
          >
            <Icon icon="bus" /> <span>Go to another instance…</span>
          </MenuItem>
          {currentInstance !== instance && (
            <MenuItem
              onClick={() => {
                location.hash = `/${currentInstance}/trending`;
              }}
            >
              <Icon icon="bus" />{' '}
              <small class="menu-double-lines">
                Go to my instance (<b>{currentInstance}</b>)
              </small>
            </MenuItem>
          )}
        </Menu2>
      }
    />
  );
}

export default Trending;
