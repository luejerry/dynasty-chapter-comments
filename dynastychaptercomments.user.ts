// ==UserScript==
// @name        Dynasty Chapter Comments
// @author      cyricc
// @description Mark chapters that you have already read in Dynasty Scans chapter lists.
// @namespace   https://dynasty-scans.com
// @include     https://dynasty-scans.com/chapters/*
// @version     0.1.0
// @grant       none
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
    margin-left: 16px;
  }

  .chaptercomments-post-header {
    margin-bottom: 6px;
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
    width: 100px;
    text-align: center;
    background: rgba(0, 0, 0, 0.8);
    font-weight: bold;
    color: #ffffff;
    padding: 5px;
  }

  .chaptercomments-no-posts {
    margin: auto;
    /* font-style: italic; */
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
  `;

  applyGlobalStyles(styles);
  initialize();

  function initialize(): void {
    const mainViewDiv = document.createElement('div');
    mainViewDiv.id = 'chaptercomments-view';
    mainViewDiv.classList.add('hidden');
    const reader = document.getElementById('reader');

    const controlDiv = document.createElement('div');
    controlDiv.classList.add('chaptercomments-control');

    const showButton = renderLoadComments();
    const hideButton = renderHideComments();
    showButton.addEventListener('click', () => {
      showButton.remove();
      mainViewDiv.classList.remove('hidden');
      controlDiv.append(hideButton);
      window.scrollBy({ top: 300, behavior: 'smooth' });
    });
    hideButton.addEventListener('click', () => {
      hideButton.remove();
      mainViewDiv.classList.add('hidden');
      controlDiv.append(showButton);
    });

    const loadButton = renderLoadComments();
    loadButton.addEventListener('click', () => {
      mainViewDiv.classList.remove('hidden');
      loadButton.remove();
      controlDiv.append(hideButton);
      main(mainViewDiv);
    });
    controlDiv.append(loadButton);

    reader.append(controlDiv);
    reader.append(mainViewDiv);
  }

  async function main(mainView: HTMLDivElement): Promise<void> {
    const loadingDiv = renderLoadingPosts();
    mainView.append(loadingDiv);
    window.scrollBy({ top: 300, behavior: 'smooth' });

    const chapterJson: ChapterJson = await fetch(`${window.location.pathname}.json`).then(r =>
      r.json(),
    );
    const seriesTag: TagJson = chapterJson.tags.find(t => t.type === 'Series');
    if (!seriesTag) {
      return;
    }

    // const seriesJson: SeriesJson1 = await fetch(`/series/${seriesTag.permalink}.json`).then(r =>
    //   r.json(),
    // );

    // const chapterIndex = seriesJson.taggings.findIndex(t => t.permalink === chapterJson.permalink);
    // if (chapterIndex < 0) {
    //   throw new Error('chapter not found in series, this should not happen');
    // }
    const chapterDate: Date = new Date(chapterJson.added_on);
    const utcOffset: string = chapterJson.added_on.match(/(?:-|\+)\d?\d(?:\:\d\d)?$/)[0];

    // const nextChapter = seriesJson.taggings[chapterIndex + 1];
    // let nextChapterDate: Date = undefined;
    // if (nextChapter) {
    //   const nextChapterJson: ChapterJson = await fetch(
    //     `/chapters/${nextChapter.permalink}.json`,
    //   ).then(r => r.json());
    //   nextChapterDate = new Date(nextChapterJson.added_on);
    // }
    const forumHref = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('#chapter-actions a'),
    ).find(a => a.href.includes('/forum/topics/'))?.href;
    if (!forumHref) {
      console.log('no forum post found');
      return;
    }

    const [
      nextChapterDate,
      { forumDoc: forumPage, page: pageNum, numPages: maxPage },
    ] = await Promise.all([
      getNextChapterDate(chapterJson, seriesTag),
      getChapterForumPage({
        forumPath: forumHref,
        minDate: chapterDate,
        utcOffset: utcOffset,
      }),
    ]);

    loadingDiv.remove();

    // const { forumDoc: forumPage, page: pageNum, numPages: maxPage } = await getChapterForumPage({
    //   forumPath: forumHref,
    //   minDate: chapterDate,
    //   utcOffset: utcOffset,
    // });
    console.log(forumPage, pageNum);

    if (!forumPage) {
      console.log('no posts found');
      return;
    }

    renderPosts({
      forumPath: forumHref,
      page: pageNum,
      maxPage,
      utcOffset: utcOffset,
      minDate: chapterDate,
      maxDate: nextChapterDate,
      container: mainView,
    });
  }

  function applyGlobalStyles(styleText: string): void {
    const docHead = document.getElementsByTagName('head')[0];
    const style = document.createElement('style');
    style.innerHTML = styleText;
    docHead.appendChild(style);
  }

  async function getNextChapterDate(chapterJson: ChapterJson, seriesTag: TagJson): Promise<Date> {
    const seriesJson: SeriesJson1 = await fetch(`/series/${seriesTag.permalink}.json`).then(r =>
      r.json(),
    );
    const chapterIndex = seriesJson.taggings.findIndex(t => t.permalink === chapterJson.permalink);
    if (chapterIndex < 0) {
      throw new Error('chapter not found in series, this should not happen');
    }

    const nextChapter = seriesJson.taggings[chapterIndex + 1];
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

  function renderLoadComments(): HTMLButtonElement {
    const loadButton = document.createElement('button');
    loadButton.textContent = 'Show comments ';
    const loadIcon = document.createElement('i');
    loadIcon.classList.add('icon-chevron-down');
    loadButton.append(loadIcon);
    return loadButton;
  }

  function renderHideComments(): HTMLButtonElement {
    const hideButton = document.createElement('button');
    hideButton.textContent = 'Hide comments ';
    const hideIcon = document.createElement('i');
    hideIcon.classList.add('icon-chevron-up');
    hideButton.append(hideIcon);
    return hideButton;
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

  function renderForumPost(post: ForumPost): HTMLDivElement {
    const postContainerDiv = document.createElement('div');
    postContainerDiv.classList.add('chaptercomments-post');
    const thumbnailDiv = document.createElement('div');
    thumbnailDiv.classList.add('chaptercomments-thumbnail-container');
    if (post.thumbnail) {
      const thumbnailImg = document.createElement('img');
      thumbnailImg.classList.add('chaptercomments-thumbnail-image');
      thumbnailImg.src = post.thumbnail;
      thumbnailDiv.appendChild(thumbnailImg);
    }
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
      second: 'numeric',
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
  }): Promise<void> {
    if (page > maxPage) {
      return;
    }
    const loadingDiv = renderLoadingPosts();
    container.append(loadingDiv);
    const forumPage = await getForumPage(forumPath, page);
    container.removeChild(loadingDiv);
    const forumPosts: ForumPost[] = mapForumPosts(forumPage, utcOffset);
    console.log(forumPosts);
    const postsInInterval = forumPosts
      .filter(post => post.date > minDate)
      .filter(post => !maxDate || post.date < maxDate);
    console.log('chapter date', minDate);
    console.log('next chapter date', maxDate);
    console.log(postsInInterval);
    if (!postsInInterval.length) {
      container.append(renderNoPosts());
      return;
    }
    const renderedPosts = postsInInterval.map(post => renderForumPost(post));
    container.append(...renderedPosts);
    if (maxDate && forumPosts.every(post => post.date < maxDate)) {
      console.log('more posts possible, rendering additional page:', page + 1);
      renderPosts({
        forumPath,
        page: page + 1,
        maxPage,
        utcOffset,
        minDate,
        maxDate,
        container,
      });
    }
  }

  async function getForumPage(forumPath: string, page: number): Promise<Document> {
    if (forumPageCache[page]) {
      console.log('cache hit', page);
      return forumPageCache[page];
    }
    const forumDoc = await fetch(`${forumPath}?page=${page}`)
      .then(r => r.text())
      .then(html => new DOMParser().parseFromString(html, 'text/html'));
    console.log('cache miss', page);
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
    const forumDoc = await getForumPage(forumPath, 1);

    const pageControls = Array.from(forumDoc.querySelectorAll('.pagination li'));
    const numPages = pageControls.length
      ? parseInt(pageControls[pageControls.length - 2].textContent, 10)
      : 1;

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
      console.log('min = max', max);
      const { forumDoc, compare } = await scanForumPage(forumPath, max, minDate, utcOffset);
      if (compare <= 0) {
        console.log('found at', max, forumDoc);
        return { forumDoc, page: max };
      } else {
        return { page: max };
      }
    }
    const page = Math.floor((max + min) / 2);
    const { compare, forumDoc } = await scanForumPage(forumPath, page, minDate, utcOffset);
    if (compare === 0) {
      console.log('found at ', page);
      return { forumDoc, page };
    } else if (compare < 0) {
      if (page === min) {
        console.log('min reached', page);
        return { forumDoc, page };
      }
      console.log(min, max, 'looking below', page);
      const result = await binarySearch(forumPath, minDate, { min, max: page - 1, utcOffset });
      if (!result.forumDoc) {
        console.log('returning ', page);
      }
      return result.forumDoc ? result : { forumDoc, page };
    } else {
      if (page === max) {
        console.log('max reached', page);
        return { forumDoc, page };
      }
      console.log(min, max, 'looking above', page);
      return await binarySearch(forumPath, minDate, { min: page + 1, max, utcOffset });
    }
  }
})();
