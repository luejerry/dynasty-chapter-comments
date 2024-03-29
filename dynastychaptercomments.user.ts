// ==UserScript==
// @name        Dynasty Chapter Comments
// @author      cyricc
// @description View forum posts for a chapter directly from a chapter page.
// @namespace   https://dynasty-scans.com
// @include     https://dynasty-scans.com/chapters/*
// @version     0.5.0
// @grant       none
// @downloadURL https://github.com/luejerry/dynasty-chapter-comments/raw/master/dist/dynastychaptercomments.user.js
// @updateURL   https://github.com/luejerry/dynasty-chapter-comments/raw/master/dist/dynastychaptercomments.user.js
// ==/UserScript==

interface ChapterJson {
  permalink: string;
  /**
   * ISO 8601 datetime
   */
  added_on: string;
  /**
   * YYYY-MM-DD
   */
  released_on: string;
  title: string;
  tags: TagJson[];
}

interface TagJson {
  type: string;
  name: string;
  permalink: string;
}

interface SeriesJson1 {
  permalink: string;
  taggings: TaggingJson[];
}

interface TaggingJson {
  title: string;
  permalink: string;
  /**
   * YYYY-MM-DD
   */
  released_on: string;
}

interface ForumPost {
  author: string;
  postUrl: string;
  authorUrl: string;
  thumbnail: string;
  date: Date;
  body: Element;
}

(async function () {
  const forumPageCache: Record<number, Document> = {};

  const styles = `
  #chaptercomments-scroll-container {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow-y: scroll;
    overscroll-behavior: contain;
    z-index: 101;
    background: rgba(0, 0, 0, 0.6);
  }
  #chaptercomments-view {
    display: flex;
    flex-direction: column;
    text-align: initial;
    margin: 24px auto;
    box-sizing: border-box;
    max-width: 844px;
    background: white;
    padding: 40px 64px;
    border-radius: 3px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.055);
  }

  #chaptercomments-view.hidden {
    display: none;
  }

  .chaptercomments-post {
    display: flex;
    flex-direction: row;
    margin-bottom: 20px;
  }

  .chaptercomments-thumbnail-container {
    width: 64px;
    min-width: 64px;
  }

  .chaptercomments-post-body {
    margin-left: 10px;
    width: 100%;
  }

  .chaptercomments-post-header {
    margin-bottom: 4px;
    padding: 4px 6px;
    background: #eee;
  }

  .chaptercomments-post-body .message {
    padding: 0 6px;
    overflow-wrap: anywhere;
  }

  .chaptercomments-author-link {
    font-weight: 700;
    display: inline-block;
    margin-right: 10px;
  }

  .chaptercomments-date-link {
    font-size: 12px;
    color: #999999;
  }

  .chaptercomments-loading-posts {
    margin: auto;
    min-width: 100px;
    text-align: center;
    background: rgba(0, 0, 0, 0.8);
    font-weight: bold;
    color: #ffffff;
    padding: 5px;
  }

  .chaptercomments-no-posts {
    margin: auto;
    color: #999;
  }

  .chaptercomments-control button {
    border: none;
    background: none;
    opacity: 0.4;
  }

  .chaptercomments-control button:focus {
    outline: none;
  }

  .chaptercomments-control {
    margin-top: 16px;
  }

  .chaptercomments-footer {
    display: flex;
    justify-content: center;
  }

  .chaptercomments-footer button {
    border: none;
    background: none;
    opacity: 0.4;
  }

  .chaptercomments-footer button:focus {
    outline: none;
  }
  `;

  let loadingElement: HTMLDivElement;

  applyGlobalStyles(styles);
  initialize();

  function initialize(): void {
    const reader = document.getElementById('reader');
    const scrollContainer = renderScrollContainer();
    const mainViewDiv = renderMainView();
    const controlDiv = renderControlBar();
    const showButton = renderLoadComments();
    // const hideButton = renderHideComments();
    showButton.addEventListener('click', () => {
      // showButton.remove();
      scrollContainer.classList.remove('hidden');
      // controlDiv.append(hideButton);
      window.scrollBy({ top: 300, behavior: 'smooth' });
    });
    scrollContainer.addEventListener('click', () => {
      // hideButton.remove();
      scrollContainer.classList.add('hidden');
      // controlDiv.append(showButton);
    });
    mainViewDiv.addEventListener('click', (event: Event) => {
      event.stopPropagation();
    });
    const loadButton = renderLoadComments();
    loadButton.addEventListener('click', async () => {
      scrollContainer.classList.remove('hidden');
      loadButton.remove();
      controlDiv.append(showButton);
      try {
        await main(mainViewDiv);
      } catch (err) {
        mainViewDiv.append(renderError());
        throw err;
      }
    });
    controlDiv.append(loadButton);

    reader.append(controlDiv);
    scrollContainer.append(mainViewDiv);
    reader.append(scrollContainer);
  }

  async function main(mainView: HTMLDivElement): Promise<void> {
    const loadingDiv = renderLoadingPosts();
    loadingElement = loadingDiv;
    mainView.append(loadingDiv);
    window.scrollBy({ top: 300, behavior: 'smooth' });

    logText('Fetching chapter information...');
    const chapterJson: ChapterJson = await fetch(`${window.location.pathname}.json`).then(r =>
      r.json(),
    );
    const seriesTag: TagJson = chapterJson.tags.find(t => t.type === 'Series');

    const chapterDate: Date = new Date(chapterJson.added_on);
    const utcOffset: string = chapterJson.added_on.match(/(?:-|\+)\d?\d(?:\:\d\d)?$/)[0];

    const forumHref = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('#chapter-actions a'),
    ).find(a => a.href.includes('/forum/topics/'))?.href;
    if (!forumHref) {
      loadingDiv.remove();
      mainView.append(renderNoPosts());
      return;
    }

    const [nextChapterDate, { forumDoc: forumPage, page: pageNum, numPages: maxPage }] =
      await Promise.all([
        getNextChapterDate(chapterJson, seriesTag),
        getChapterForumPage({
          forumPath: forumHref,
          minDate: chapterDate,
          utcOffset: utcOffset,
        }),
      ]);
    // console.log('looking from', chapterDate);
    // console.log('looking to  ', nextChapterDate);

    loadingDiv.remove();

    if (!forumPage || (nextChapterDate && chapterDate > nextChapterDate)) {
      mainView.append(renderNoPosts());
      return;
    }

    const posts = await renderPosts({
      forumPath: forumHref,
      page: pageNum,
      maxPage,
      utcOffset: utcOffset,
      minDate: chapterDate,
      maxDate: nextChapterDate,
      container: mainView,
    });
    if (posts.length) {
      mainView.append(renderFooter());
    } else {
      mainView.append(renderNoPosts());
    }
  }

  function applyGlobalStyles(styleText: string): void {
    const docHead = document.getElementsByTagName('head')[0];
    const style = document.createElement('style');
    style.innerHTML = styleText;
    docHead.appendChild(style);
  }

  function logText(text: string): void {
    loadingElement.textContent = text;
  }

  async function asyncTimeout(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function getNextChapterDate(chapterJson: ChapterJson, seriesTag: TagJson): Promise<Date> {
    if (!seriesTag) {
      return null;
    }
    const seriesJson: SeriesJson1 = await fetch(`/series/${seriesTag.permalink}.json`).then(r =>
      r.json(),
    );
    const taggings = seriesJson.taggings.filter(t => t.permalink);
    const chapterIndex = taggings.findIndex(t => t.permalink === chapterJson.permalink);
    if (chapterIndex < 0) {
      throw new Error('chapter not found in series, this should not happen');
    }

    const nextChapter = taggings[chapterIndex + 1];
    if (!nextChapter) {
      return null;
    }
    const nextChapterJson: ChapterJson = await fetch(
      `/chapters/${nextChapter.permalink}.json`,
    ).then(r => r.json());
    return new Date(nextChapterJson.added_on);
  }

  function mapForumPosts(forumDoc: Document, utcOffset: string): ForumPost[] {
    return Array.from(forumDoc.querySelectorAll<HTMLDivElement>('.forum_post')).map(postDiv => {
      const author = postDiv.querySelector<HTMLDivElement>('.user').innerText.trim();
      const displayTime = postDiv.querySelector<HTMLDivElement>('.time').innerText;
      const authorUrl = postDiv.querySelector<HTMLAnchorElement>('.details .count a')?.href;
      const postUrl = postDiv.querySelector<HTMLAnchorElement>('.time a').href;
      const thumbnail = postDiv.querySelector<HTMLImageElement>('.avatar img')?.src;
      const body = postDiv.querySelector<HTMLDivElement>('.message');
      return {
        author,
        authorUrl,
        body,
        date: displayTimeToDate(displayTime, utcOffset),
        postUrl,
        thumbnail,
      };
    });
  }

  function renderScrollContainer(): HTMLDivElement {
    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'chaptercomments-scroll-container';
    scrollContainer.classList.add('hidden');
    return scrollContainer;
  }
  function renderMainView(): HTMLDivElement {
    const mainViewDiv = document.createElement('div');
    mainViewDiv.id = 'chaptercomments-view';
    return mainViewDiv;
  }

  function renderControlBar(): HTMLDivElement {
    const controlDiv = document.createElement('div');
    controlDiv.classList.add('chaptercomments-control');
    return controlDiv;
  }

  function renderLoadComments(): HTMLButtonElement {
    const loadButton = document.createElement('button');
    loadButton.textContent = 'Show comments ';
    const loadIcon = document.createElement('i');
    loadIcon.classList.add('icon-chevron-down');
    loadButton.append(loadIcon);
    return loadButton;
  }

  // function renderHideComments(): HTMLButtonElement {
  //   const hideButton = document.createElement('button');
  //   hideButton.textContent = 'Hide comments ';
  //   const hideIcon = document.createElement('i');
  //   hideIcon.classList.add('icon-chevron-up');
  //   hideButton.append(hideIcon);
  //   return hideButton;
  // }

  function renderFooter(): HTMLDivElement {
    const footerDiv = document.createElement('div');
    footerDiv.classList.add('chaptercomments-footer');
    const backTopButton = document.createElement('button');
    backTopButton.classList.add('chaptercomments-back-top-button');
    backTopButton.textContent = 'Back to top ';
    backTopButton.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    const upIcon = document.createElement('i');
    upIcon.classList.add('icon-chevron-up');
    backTopButton.append(upIcon);
    footerDiv.append(backTopButton);
    return footerDiv;
  }

  function renderLoadingPosts(): HTMLDivElement {
    const emptyContainerDiv = document.createElement('div');
    emptyContainerDiv.classList.add('chaptercomments-loading-posts');
    emptyContainerDiv.textContent = 'Loading...';
    return emptyContainerDiv;
  }

  function renderNoPosts(): HTMLDivElement {
    const emptyContainerDiv = document.createElement('div');
    emptyContainerDiv.classList.add('chaptercomments-no-posts');
    emptyContainerDiv.textContent = 'No forum posts for this chapter.';
    return emptyContainerDiv;
  }

  function renderError(): HTMLDivElement {
    const errorDiv = document.createElement('div');
    errorDiv.classList.add('chaptercomments-no-posts');
    errorDiv.textContent = 'Sorry, an error occurred trying to load forum posts.';
    return errorDiv;
  }

  function renderForumPost(post: ForumPost): HTMLDivElement {
    const postContainerDiv = document.createElement('div');
    postContainerDiv.classList.add('chaptercomments-post');
    const thumbnailDiv = document.createElement('div');
    thumbnailDiv.classList.add('chaptercomments-thumbnail-container');
    const thumbnailImg = document.createElement('img');
    thumbnailImg.classList.add('chaptercomments-thumbnail-image');
    thumbnailImg.src = post.thumbnail || '/assets/avatar_missing_thumb.png';
    thumbnailDiv.appendChild(thumbnailImg);
    postContainerDiv.appendChild(thumbnailDiv);
    const bodyContainerDiv = document.createElement('div');
    bodyContainerDiv.classList.add('chaptercomments-post-body');
    const bodyHeaderDiv = document.createElement('div');
    bodyHeaderDiv.classList.add('chaptercomments-post-header');
    const authorA = document.createElement('a');
    authorA.classList.add('chaptercomments-author-link');
    authorA.href = post.authorUrl;
    authorA.textContent = post.author;
    const dateA = document.createElement('a');
    dateA.classList.add('chaptercomments-date-link');
    dateA.href = post.postUrl;
    dateA.textContent = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).format(post.date);
    bodyHeaderDiv.append(authorA, dateA);
    post.body.classList.remove('span10');
    bodyContainerDiv.append(bodyHeaderDiv, post.body);
    postContainerDiv.append(bodyContainerDiv);
    return postContainerDiv;
  }

  async function renderPosts({
    forumPath,
    page,
    maxPage,
    utcOffset,
    minDate,
    maxDate,
    container,
  }: {
    forumPath: string;
    page: number;
    maxPage: number;
    utcOffset: string;
    minDate: Date;
    maxDate: Date;
    container: HTMLDivElement;
  }): Promise<ForumPost[]> {
    if (page > maxPage) {
      return [];
    }
    const loadingDiv = renderLoadingPosts();
    container.append(loadingDiv);
    const forumPage = await getForumPage(forumPath, page);
    container.removeChild(loadingDiv);
    const forumPosts: ForumPost[] = mapForumPosts(forumPage, utcOffset);
    const postsInInterval = forumPosts
      .filter(post => post.date > minDate)
      .filter(post => !maxDate || post.date < maxDate);
    const renderedPosts = postsInInterval.map(post => renderForumPost(post));
    container.append(...renderedPosts);
    if (!maxDate || forumPosts.every(post => post.date < maxDate)) {
      return [
        ...postsInInterval,
        ...(await renderPosts({
          forumPath,
          page: page + 1,
          maxPage,
          utcOffset,
          minDate,
          maxDate,
          container,
        })),
      ];
    }
    return postsInInterval;
  }

  async function getForumPage(forumPath: string, page: number): Promise<Document> {
    if (forumPageCache[page]) {
      return forumPageCache[page];
    }
    const forumDoc = await fetch(`${forumPath}?page=${page}`)
      .then(r => r.text())
      .then(html => new DOMParser().parseFromString(html, 'text/html'));
    forumPageCache[page] = forumDoc;
    return forumDoc;
  }

  async function getChapterForumPage({
    forumPath,
    minDate,
    utcOffset,
  }: {
    forumPath: string;
    minDate: Date;
    utcOffset: string;
  }): Promise<{
    forumDoc?: Document;
    page: number;
    numPages: number;
  }> {
    logText('Fetching series forum page...');
    const forumDoc = await getForumPage(forumPath, 1);
    const pageControls = Array.from(forumDoc.querySelectorAll('.pagination li'));
    const numPages = pageControls.length
      ? parseInt(pageControls[pageControls.length - 2].textContent, 10)
      : 1;

    logText(`Searching ${numPages} pages`);
    const result = await binarySearch(forumPath, minDate, {
      min: 1,
      max: numPages,
      utcOffset: utcOffset,
    });
    return {
      ...result,
      numPages,
    };
  }

  function displayTimeToDate(displayTime: string, utcOffset: string): Date {
    const dateString = displayTime.trim().replace(/(AM|PM)/, ` $1 UTC${utcOffset}`);
    return new Date(dateString);
  }

  async function scanForumPage(
    forumPath: string,
    page: number,
    minDate: Date,
    utcOffset: string,
  ): Promise<{ compare: number; forumDoc?: Document }> {
    const forumDoc = await getForumPage(forumPath, page);
    const dates = Array.from(forumDoc.querySelectorAll<HTMLElement>('.row .time'))
      .map(timeDiv => timeDiv.innerText)
      .map(displayTime => displayTimeToDate(displayTime, utcOffset));
    const hasAfterMinDate = dates.some(date => date > minDate);
    const hasBeforeMinDate = dates.some(date => date < minDate);
    if (!hasAfterMinDate) {
      return { compare: 1 };
    } else if (!hasBeforeMinDate) {
      return { compare: -1, forumDoc };
    } else {
      return {
        compare: 0,
        forumDoc,
      };
    }
  }

  async function binarySearch(
    forumPath: string,
    minDate: Date,
    { min, max, utcOffset }: { min: number; max: number; utcOffset: string },
  ): Promise<{ forumDoc?: Document; page: number }> {
    if (min >= max) {
      logText(`Searching page ${max}`);
      const { forumDoc, compare } = await scanForumPage(forumPath, max, minDate, utcOffset);
      if (compare <= 0) {
        // console.log('found on page', max);
        return { forumDoc, page: max };
      } else {
        return { page: max };
      }
    }
    const page = Math.floor((max + min) / 2);
    logText(`Searching page ${page} (${min}-${max})`);
    const { compare, forumDoc } = await scanForumPage(forumPath, page, minDate, utcOffset);
    if (compare === 0) {
      // console.log('found on page', page);
      return { forumDoc, page };
    } else if (compare < 0) {
      await asyncTimeout(1000);
      return await binarySearch(forumPath, minDate, { min, max: page, utcOffset });
    } else {
      await asyncTimeout(1000);
      return await binarySearch(forumPath, minDate, { min: page + 1, max, utcOffset });
    }
  }
})();
