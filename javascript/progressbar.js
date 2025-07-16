// code related to showing and updating progressbar shown as the image is being made

function rememberGallerySelection() {

}

function getGallerySelectedIndex() {

}

function request(url, data, handler, errorHandler) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                try {
                    var js = JSON.parse(xhr.responseText);
                    handler(js);
                } catch (error) {
                    console.error(error);
                    errorHandler();
                }
            } else {
                errorHandler();
            }
        }
    };
    var js = JSON.stringify(data);
    xhr.send(js);
}

function pad2(x) {
    return x < 10 ? '0' + x : x;
}

function formatTime(secs) {
    if (secs > 3600) {
        return pad2(Math.floor(secs / 60 / 60)) + ":" + pad2(Math.floor(secs / 60) % 60) + ":" + pad2(Math.floor(secs) % 60);
    } else if (secs > 60) {
        return pad2(Math.floor(secs / 60)) + ":" + pad2(Math.floor(secs) % 60);
    } else {
        return Math.floor(secs) + "s";
    }
}


var originalAppTitle = undefined;

onUiLoaded(function() {
    originalAppTitle = document.title;
});

function setTitle(progress) {
    var title = originalAppTitle;

    if (opts.show_progress_in_title && progress) {
        title = '[' + progress.trim() + '] ' + title;
    }

    if (document.title != title) {
        document.title = title;
    }
}

function getElemValue(id) {
    const el = gradioApp().querySelector(`#${id} input, #${id} textarea, #${id} select`);
    if (!el) {
        console.warn(`[getElemValue] 未找到元素: #${id}`);
        return null;
    }
    return el.value;
}

function getCurrentWebUIConfig() {
    const tab = get_tab_index('tabs') === 0 ? 'txt2img' : 'img2img';
    const config = {
        width: getElemValue(`${tab}_width`),
        height: getElemValue(`${tab}_height`),
        batch_size: getElemValue(`${tab}_batch_size`),
        batch_count: getElemValue(`${tab}_batch_count`),
        steps: getElemValue(`${tab}_steps`),
        cfg_scale: getElemValue(`${tab}_cfg_scale`),
        prompt: getElemValue(`${tab}_prompt`),
        neg_prompt: getElemValue(`${tab}_neg_prompt`),
        model: opts.sd_model_checkpoint
    };
    return config;
}


function randomId() {
    task_id="task(" + Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 7) + ")";
    window.parent.postMessage({ type: 'estimate_up',prompt_id: task_id, value:get_compute_estimate() }, '*'); //向上级页面发送估算算力信号
    const config = getCurrentWebUIConfig(); // 获取当前参数配置
    const compute = get_compute_estimate();
    // 向父页面发送估算算力和当前配置
    window.parent.postMessage({
        type: 'estimate_up',
        prompt_id: task_id,
        value: compute,
    }, '*');
    console.log(config)
    const formData = new FormData();
    formData.append("id_task", task_id);
    formData.append("config", JSON.stringify(config));
    formData.append("callback_url", localGet("callback_url") || "");
    fetch("https://comfyui.fireai.cn:8180/api/webui/history/init", {
        method: "POST",
        body: formData
    }).catch(err => console.error(err));
    return task_id;
}

// starts sending progress requests to "/internal/progress" uri, creating progressbar above progressbarContainer element and
// preview inside gallery element. Cleans up all created stuff when the task is over and calls atEnd.
// calls onProgress every time there is a progress update
function requestProgress(id_task, progressbarContainer, gallery, atEnd, onProgress, inactivityTimeout = 40) {
    var dateStart = new Date();
    var wasEverActive = false;
    var parentProgressbar = progressbarContainer.parentNode;
    var wakeLock = null;

    var requestWakeLock = async function() {
        if (!opts.prevent_screen_sleep_during_generation || wakeLock) return;
        try {
            wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {
            console.error('Wake Lock is not supported.');
        }
    };

    var releaseWakeLock = async function() {
        if (!opts.prevent_screen_sleep_during_generation || !wakeLock) return;
        try {
            await wakeLock.release();
            wakeLock = null;
        } catch (err) {
            console.error('Wake Lock release failed', err);
        }
    };

    var divProgress = document.createElement('div');
    divProgress.className = 'progressDiv';
    divProgress.style.display = opts.show_progressbar ? "block" : "none";
    var divInner = document.createElement('div');
    divInner.className = 'progress';

    divProgress.appendChild(divInner);
    parentProgressbar.insertBefore(divProgress, progressbarContainer);

    var livePreview = null;

    var removeProgressBar = function() {
        releaseWakeLock();
        if (!divProgress) return;

        setTitle("");
        parentProgressbar.removeChild(divProgress);
        if (gallery && livePreview) gallery.removeChild(livePreview);
        atEnd();

        divProgress = null;
    };

    var funProgress = function(id_task) {
        requestWakeLock();
        request("./internal/progress", {id_task: id_task, live_preview: false}, function(res) {
            if (res.completed) {
                sent_is_completed();//向上级页面发送已完成信号
                removeProgressBar();
                return;
            }

            let progressText = "";

            divInner.style.width = ((res.progress || 0) * 100.0) + '%';
            divInner.style.background = res.progress ? "" : "transparent";

            if (res.progress > 0) {
                progressText = ((res.progress || 0) * 100.0).toFixed(0) + '%';
            }

            if (res.eta) {
                progressText += " ETA: " + formatTime(res.eta);
            }

            setTitle(progressText);

            if (res.textinfo && res.textinfo.indexOf("\n") == -1) {
                progressText = res.textinfo + " " + progressText;
            }

            divInner.textContent = progressText;

            var elapsedFromStart = (new Date() - dateStart) / 1000;

            if (res.active) wasEverActive = true;

            if (!res.active && wasEverActive) {
                removeProgressBar();
                return;
            }

            if (elapsedFromStart > inactivityTimeout && !res.queued && !res.active) {
                removeProgressBar();
                return;
            }

            if (onProgress) {
                onProgress(res);
            }

            setTimeout(() => {
                funProgress(id_task, res.id_live_preview);
            }, opts.live_preview_refresh_period || 500);
        }, function() {
            removeProgressBar();
        });
    };

    var funLivePreview = function(id_task, id_live_preview) {
        request("./internal/progress", {id_task: id_task, id_live_preview: id_live_preview}, function(res) {
            if (!divProgress) {
                return;
            }

            if (res.live_preview && gallery) {
                var img = new Image();
                img.onload = function() {
                    if (!livePreview) {
                        livePreview = document.createElement('div');
                        livePreview.className = 'livePreview';
                        gallery.insertBefore(livePreview, gallery.firstElementChild);
                    }

                    livePreview.appendChild(img);
                    if (livePreview.childElementCount > 2) {
                        livePreview.removeChild(livePreview.firstElementChild);
                    }
                };
                img.src = res.live_preview;
            }

            setTimeout(() => {
                funLivePreview(id_task, res.id_live_preview);
            }, opts.live_preview_refresh_period || 500);
        }, function() {
            removeProgressBar();
        });
    };

    funProgress(id_task, 0);

    if (gallery) {
        funLivePreview(id_task, 0);
    }

}
