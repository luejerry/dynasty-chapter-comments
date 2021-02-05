"use strict";
// ==UserScript==
// @name        Dynasty Chapter Comments
// @author      cyricc
// @description View forum posts for a chapter directly from a chapter page.
// @namespace   https://dynasty-scans.com
// @include     https://dynasty-scans.com/chapters/*
// @version     0.2.3
// @grant       none
// @downloadURL https://github.com/luejerry/dynasty-chapter-comments/raw/master/dist/dynastychaptercomments.user.js
// @updateURL   https://github.com/luejerry/dynasty-chapter-comments/raw/master/dist/dynastychaptercomments.user.js
// ==/UserScript==
(async function () {
    const forumPageCache = {};
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
    function initialize() {
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
        loadButton.addEventListener('click', async () => {
            mainViewDiv.classList.remove('hidden');
            loadButton.remove();
            controlDiv.append(hideButton);
            try {
                await main(mainViewDiv);
            }
            catch (err) {
                mainViewDiv.append(renderError());
            }
        });
        controlDiv.append(loadButton);
        reader.append(controlDiv);
        reader.append(mainViewDiv);
    }
    async function main(mainView) {
        var _a;
        const loadingDiv = renderLoadingPosts();
        mainView.append(loadingDiv);
        window.scrollBy({ top: 300, behavior: 'smooth' });
        const chapterJson = await fetch(`${window.location.pathname}.json`).then(r => r.json());
        const seriesTag = chapterJson.tags.find(t => t.type === 'Series');
        // if (!seriesTag) {
        //   loadingDiv.remove();
        //   mainView.append(renderUnsupported());
        //   return;
        // }
        const chapterDate = new Date(chapterJson.added_on);
        const utcOffset = chapterJson.added_on.match(/(?:-|\+)\d?\d(?:\:\d\d)?$/)[0];
        const forumHref = (_a = Array.from(document.querySelectorAll('#chapter-actions a')).find(a => a.href.includes('/forum/topics/'))) === null || _a === void 0 ? void 0 : _a.href;
        if (!forumHref) {
            loadingDiv.remove();
            mainView.append(renderNoPosts());
            return;
        }
        const [nextChapterDate, { forumDoc: forumPage, page: pageNum, numPages: maxPage },] = await Promise.all([
            getNextChapterDate(chapterJson, seriesTag),
            getChapterForumPage({
                forumPath: forumHref,
                minDate: chapterDate,
                utcOffset: utcOffset,
            }),
        ]);
        loadingDiv.remove();
        if (!forumPage) {
            mainView.append(renderNoPosts());
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
    function applyGlobalStyles(styleText) {
        const docHead = document.getElementsByTagName('head')[0];
        const style = document.createElement('style');
        style.innerHTML = styleText;
        docHead.appendChild(style);
    }
    async function getNextChapterDate(chapterJson, seriesTag) {
        if (!seriesTag) {
            return null;
        }
        const seriesJson = await fetch(`/series/${seriesTag.permalink}.json`).then(r => r.json());
        const taggings = seriesJson.taggings.filter(t => t.permalink);
        const chapterIndex = taggings.findIndex(t => t.permalink === chapterJson.permalink);
        if (chapterIndex < 0) {
            throw new Error('chapter not found in series, this should not happen');
        }
        const nextChapter = taggings[chapterIndex + 1];
        if (!nextChapter) {
            return null;
        }
        const nextChapterJson = await fetch(`/chapters/${nextChapter.permalink}.json`).then(r => r.json());
        return new Date(nextChapterJson.added_on);
    }
    function mapForumPosts(forumDoc, utcOffset) {
        return Array.from(forumDoc.querySelectorAll('.forum_post')).map(postDiv => {
            var _a, _b;
            const author = postDiv.querySelector('.user').innerText.trim();
            const displayTime = postDiv.querySelector('.time').innerText;
            const authorUrl = (_a = postDiv.querySelector('.details .count a')) === null || _a === void 0 ? void 0 : _a.href;
            const postUrl = postDiv.querySelector('.time a').href;
            const thumbnail = (_b = postDiv.querySelector('.avatar img')) === null || _b === void 0 ? void 0 : _b.src;
            const body = postDiv.querySelector('.message');
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
    function renderLoadComments() {
        const loadButton = document.createElement('button');
        loadButton.textContent = 'Show comments ';
        const loadIcon = document.createElement('i');
        loadIcon.classList.add('icon-chevron-down');
        loadButton.append(loadIcon);
        return loadButton;
    }
    function renderHideComments() {
        const hideButton = document.createElement('button');
        hideButton.textContent = 'Hide comments ';
        const hideIcon = document.createElement('i');
        hideIcon.classList.add('icon-chevron-up');
        hideButton.append(hideIcon);
        return hideButton;
    }
    function renderLoadingPosts() {
        const emptyContainerDiv = document.createElement('div');
        emptyContainerDiv.classList.add('chaptercomments-loading-posts');
        emptyContainerDiv.textContent = 'Loading...';
        return emptyContainerDiv;
    }
    function renderNoPosts() {
        const emptyContainerDiv = document.createElement('div');
        emptyContainerDiv.classList.add('chaptercomments-no-posts');
        emptyContainerDiv.textContent = 'No forum posts for this chapter.';
        return emptyContainerDiv;
    }
    // function renderUnsupported(): HTMLDivElement {
    //   const emptyContainerDiv = document.createElement('div');
    //   emptyContainerDiv.classList.add('chaptercomments-no-posts');
    //   emptyContainerDiv.textContent = 'Sorry, only comments for chapters in a Series can be shown.';
    //   return emptyContainerDiv;
    // }
    function renderError() {
        const errorDiv = document.createElement('div');
        errorDiv.classList.add('chaptercomments-no-posts');
        errorDiv.textContent = 'Sorry, an error occurred trying to load forum posts.';
        return errorDiv;
    }
    function renderForumPost(post) {
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
    async function renderPosts({ forumPath, page, maxPage, utcOffset, minDate, maxDate, container, }) {
        if (page > maxPage) {
            return;
        }
        const loadingDiv = renderLoadingPosts();
        container.append(loadingDiv);
        const forumPage = await getForumPage(forumPath, page);
        container.removeChild(loadingDiv);
        const forumPosts = mapForumPosts(forumPage, utcOffset);
        const postsInInterval = forumPosts
            .filter(post => post.date > minDate)
            .filter(post => !maxDate || post.date < maxDate);
        if (!postsInInterval.length) {
            container.append(renderNoPosts());
            return;
        }
        const renderedPosts = postsInInterval.map(post => renderForumPost(post));
        container.append(...renderedPosts);
        if (!maxDate || forumPosts.every(post => post.date < maxDate)) {
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
    async function getForumPage(forumPath, page) {
        if (forumPageCache[page]) {
            return forumPageCache[page];
        }
        const forumDoc = await fetch(`${forumPath}?page=${page}`)
            .then(r => r.text())
            .then(html => new DOMParser().parseFromString(html, 'text/html'));
        forumPageCache[page] = forumDoc;
        return forumDoc;
    }
    async function getChapterForumPage({ forumPath, minDate, utcOffset, }) {
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
    function displayTimeToDate(displayTime, utcOffset) {
        const dateString = displayTime.trim().replace(/(AM|PM)/, ` $1 UTC${utcOffset}`);
        return new Date(dateString);
    }
    async function scanForumPage(forumPath, page, minDate, utcOffset) {
        const forumDoc = await getForumPage(forumPath, page);
        const dates = Array.from(forumDoc.querySelectorAll('.row .time'))
            .map(timeDiv => timeDiv.innerText)
            .map(displayTime => displayTimeToDate(displayTime, utcOffset));
        const hasAfterMinDate = dates.some(date => date > minDate);
        const hasBeforeMinDate = dates.some(date => date < minDate);
        if (!hasAfterMinDate) {
            return { compare: 1 };
        }
        else if (!hasBeforeMinDate) {
            return { compare: -1, forumDoc };
        }
        else {
            return {
                compare: 0,
                forumDoc,
            };
        }
    }
    async function binarySearch(forumPath, minDate, { min, max, utcOffset }) {
        if (min >= max) {
            const { forumDoc, compare } = await scanForumPage(forumPath, max, minDate, utcOffset);
            if (compare <= 0) {
                return { forumDoc, page: max };
            }
            else {
                return { page: max };
            }
        }
        const page = Math.floor((max + min) / 2);
        const { compare, forumDoc } = await scanForumPage(forumPath, page, minDate, utcOffset);
        if (compare === 0) {
            return { forumDoc, page };
        }
        else if (compare < 0) {
            if (page === min) {
                return { forumDoc, page };
            }
            const result = await binarySearch(forumPath, minDate, { min, max: page - 1, utcOffset });
            if (!result.forumDoc) {
            }
            return result.forumDoc ? result : { forumDoc, page };
        }
        else {
            if (page === max) {
                return { forumDoc, page };
            }
            return await binarySearch(forumPath, minDate, { min: page + 1, max, utcOffset });
        }
    }
})();
