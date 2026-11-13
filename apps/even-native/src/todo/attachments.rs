//! The files on an issue (components/board/issue-detail.tsx `AttachmentTile`,
//! components/board/image-viewer.tsx, lib/attachments.ts and the
//! `.attachment-*`, `.image-viewer*` and `.issue-dropzone` rules of app.css):
//! a grid of tiles with a preview for pictures and the file type for the
//! rest, pictures full screen with ← and →, the "drop files" cover while
//! files are dragged over the issue, and files pasted into the description.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};

use super::*;

/// lib/attachments.ts `isImage`: the types a browser shows safely in an `<img>`.
pub(super) fn is_image(content_type: &str) -> bool {
    matches!(
        content_type.to_ascii_lowercase().as_str(),
        "image/png" | "image/jpeg" | "image/jpg" | "image/gif" | "image/webp" | "image/avif" | "image/bmp" | "image/svg+xml"
    )
}

/// The letters on a tile that is not a picture: the file's extension, at
/// most five, in capitals; nothing for a name without a dot.
pub(super) fn extension(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((_, extension)) => extension.chars().take(5).collect::<String>().to_uppercase(),
        None => String::new(),
    }
}

/// How many tiles fit beside each other and how wide each is:
/// `grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 10px`.
pub(super) fn grid(width: f32) -> (usize, f32) {
    const MIN: f32 = 148.;
    const GAP: f32 = 10.;
    let columns = (((width + GAP) / (MIN + GAP)).floor() as usize).max(1);
    (columns, ((width - GAP * (columns as f32 - 1.)) / columns as f32).max(0.))
}

/// A pasted screenshot is called "image.png": the name that says when
/// (issue-detail.tsx `pasted`). `index` and `count`: which of how many.
pub(super) fn pasted_name(when: chrono::DateTime<chrono::Local>, index: usize, count: usize, extension: &str) -> String {
    let stamp = when.format("%Y-%m-%d %H.%M.%S");
    let suffix = if count > 1 { format!(" ({})", index + 1) } else { String::new() };
    t(
        format!("Pasted image {stamp}{suffix}.{extension}"),
        format!("Geplakte afbeelding {stamp}{suffix}.{extension}"),
    )
}

/// A picture's bytes as something GPUI draws, told by how the file starts.
fn decode(bytes: Vec<u8>) -> Option<Arc<Image>> {
    let format = match bytes.as_slice() {
        [0x89, b'P', b'N', b'G', ..] => ImageFormat::Png,
        [0xff, 0xd8, ..] => ImageFormat::Jpeg,
        [b'G', b'I', b'F', ..] => ImageFormat::Gif,
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => ImageFormat::Webp,
        [b'B', b'M', ..] => ImageFormat::Bmp,
        [b'<', ..] => ImageFormat::Svg,
        _ => return None,
    };
    Some(Arc::new(Image::from_bytes(format, bytes)))
}

/// lib/attachments.ts `useAttachmentUrl`: loading, there, or failed.
#[derive(Clone)]
enum Preview {
    Loading,
    Ready(Arc<Image>),
    Failed,
}

/// Files never change after upload, so one picture per file serves the tile
/// and the viewer.
static PREVIEWS: LazyLock<Mutex<HashMap<String, Preview>>> = LazyLock::new(Default::default);

fn preview(id: &str) -> Option<Preview> {
    PREVIEWS.lock().ok()?.get(id).cloned()
}

/// Where pasted pictures wait until they are sent: a folder of their own
/// under the system's temporary one, emptied file by file after the upload.
fn paste_folder() -> PathBuf {
    std::env::temp_dir().join("even-pasted")
}

/// A pasted picture that was sent (or not): its file goes again.
pub(super) fn forget_pasted(path: &std::path::Path) {
    if path.starts_with(paste_folder()) {
        let _ = std::fs::remove_file(path);
        if let Some(folder) = path.parent().filter(|folder| *folder != paste_folder()) {
            let _ = std::fs::remove_dir(folder);
        }
    }
}

impl TodoApp {
    /// Fetches the pictures among `files` that were not asked for yet; a look
    /// after one failed tries again (`retry`), as the web does.
    pub(super) fn load_previews(&mut self, files: &[api::Attachment], retry: bool, cx: &mut Context<Self>) {
        let wanted: Vec<String> = {
            let Ok(mut previews) = PREVIEWS.lock() else { return };
            files
                .iter()
                .filter(|file| is_image(&file.content_type))
                .filter(|file| match previews.get(&file.id) {
                    None => true,
                    Some(Preview::Failed) => retry,
                    Some(_) => false,
                })
                .map(|file| file.id.clone())
                .collect::<Vec<_>>()
                .into_iter()
                .inspect(|id| {
                    previews.insert(id.clone(), Preview::Loading);
                })
                .collect()
        };
        if wanted.is_empty() {
            return;
        }
        let client = self.client.clone();
        let sample = self.sample;
        for id in wanted {
            let client = client.clone();
            let task = cx.background_executor().spawn(async move {
                let bytes = if sample {
                    Some(sample::picture())
                } else {
                    api::download_attachment(&client, &id).ok()
                };
                let picture = match bytes.and_then(decode) {
                    Some(image) => Preview::Ready(image),
                    None => Preview::Failed,
                };
                if let Ok(mut previews) = PREVIEWS.lock() {
                    previews.insert(id, picture);
                }
            });
            cx.spawn(async move |this, cx| {
                task.await;
                let _ = this.update(cx, |_, cx| cx.notify());
            })
            .detach();
        }
    }

    /// A tile's click: a picture opens full screen, anything else is saved.
    fn open_attachment(&mut self, file: &api::Attachment, window: &mut Window, cx: &mut Context<Self>) {
        if is_image(&file.content_type) {
            if let Some(view) = &mut self.issue {
                view.viewing = Some(file.id.clone());
                window.focus(&view.focus, cx);
                cx.notify();
            }
        } else {
            self.download_attachment(file.id.clone(), file.name.clone(), window, cx);
        }
    }

    /// ← and → in the viewer: the issue's pictures, round and round.
    pub(super) fn step_viewer(&mut self, by: isize, cx: &mut Context<Self>) {
        let Some(view) = &mut self.issue else { return };
        let Some(current) = &view.viewing else { return };
        let Some(issue) = self.data.todos.iter().find(|todo| todo.id == view.id) else { return };
        let images: Vec<&api::Attachment> = issue.attachments.iter().filter(|file| is_image(&file.content_type)).collect();
        if images.len() < 2 {
            return;
        }
        let index = images.iter().position(|image| &image.id == current).unwrap_or(0);
        let next = (index as isize + by).rem_euclid(images.len() as isize) as usize;
        view.viewing = Some(images[next].id.clone());
        cx.notify();
    }

    /// Files pasted into the description are attached to the issue
    /// (description-editor.tsx `handlePaste`): a copied picture under a name
    /// that says when, copied files as they are.
    pub(super) fn paste_files(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(issue_id) = self.issue.as_ref().map(|view| view.id.clone()) else { return };
        let read_only = self
            .data
            .todos
            .iter()
            .find(|todo| todo.id == issue_id)
            .and_then(|issue| self.data.lists.iter().find(|list| list.id == issue.list_id))
            .is_none_or(|list| list.role == api::ListRole::Viewer);
        let Some(item) = cx.read_from_clipboard() else { return };
        if read_only {
            return;
        }
        let mut paths: Vec<PathBuf> = Vec::new();
        let mut pictures: Vec<&Image> = Vec::new();
        for entry in item.entries() {
            match entry {
                ClipboardEntry::ExternalPaths(files) => paths.extend(files.paths().iter().cloned()),
                ClipboardEntry::Image(image) => pictures.push(image),
                ClipboardEntry::String(_) => {}
            }
        }
        // A copied file brings a picture of its icon along: the file is what was meant.
        if paths.is_empty() {
            let folder = paste_folder().join(api::new_id());
            let now = chrono::Local::now();
            for (index, picture) in pictures.iter().enumerate() {
                let extension = match picture.format() {
                    ImageFormat::Png => "png",
                    ImageFormat::Jpeg => "jpg",
                    ImageFormat::Webp => "webp",
                    ImageFormat::Gif => "gif",
                    ImageFormat::Svg => "svg",
                    ImageFormat::Bmp => "bmp",
                    ImageFormat::Tiff => "tiff",
                    _ => "png",
                };
                let path = folder.join(pasted_name(now, index, pictures.len(), extension));
                if std::fs::create_dir_all(&folder).is_ok() && std::fs::write(&path, picture.bytes()).is_ok() {
                    paths.push(path);
                }
            }
        }
        self.upload_files(issue_id, paths, true, window, cx);
    }

    /// `.attachment-grid`: the issue's files, then the ones on their way up.
    /// `width`: the room the grid has.
    pub(super) fn render_attachment_grid(
        &self,
        issue: &Todo,
        uploads: &[String],
        read_only: bool,
        width: f32,
        cx: &mut Context<Self>,
    ) -> Div {
        let (_, tile_width) = grid(width);
        let preview_height = tile_width * 3. / 4.;
        let tile = |id: SharedString| {
            div()
                .id(id)
                .relative()
                .flex()
                .flex_col()
                .flex_none()
                .w(px(tile_width))
                .min_w_0()
                .rounded(px(10.))
                .border_1()
                .border_color(theme::border())
                .bg(theme::card())
                .overflow_hidden()
        };
        let picture_room = || {
            div()
                .relative()
                .flex()
                .flex_col()
                .flex_none()
                .items_center()
                .justify_center()
                .gap(px(6.))
                .w_full()
                .h(px(preview_height))
                .bg(theme::with_alpha(theme::muted_bg(), 0.7))
                .overflow_hidden()
        };
        let meta = || div().flex().flex_col().gap(px(1.)).pt(px(7.)).px(px(10.)).pb(px(8.)).min_w_0();
        // Button `variant="secondary" size="icon-xs"`: 24 points, a 12-point sign.
        let action = |id: SharedString, icon: &'static str| {
            div()
                .id(id)
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(24.))
                .rounded(theme::RADIUS_SM)
                .bg(theme::secondary())
                .hover(|el| el.bg(theme::with_alpha(theme::secondary(), 0.8)))
                .cursor_pointer()
                .child(theme::hi(icon).size(px(12.)).text_color(theme::foreground()))
        };

        let mut tiles = div().flex().flex_wrap().gap(px(10.));
        for file in &issue.attachments {
            let image = is_image(&file.content_type);
            let group = SharedString::from(format!("attachment-tile-{}", file.id));
            let room = if image {
                match preview(&file.id) {
                    Some(Preview::Ready(picture)) => {
                        picture_room().child(img(picture).size_full().object_fit(ObjectFit::Cover))
                    }
                    Some(Preview::Failed) => {
                        picture_room().child(theme::hi("image-02").size(px(20.)).text_color(theme::muted()))
                    }
                    // `.attachment-tile-loading`: the quiet room until the picture is in.
                    _ => picture_room().child(
                        div()
                            .size_full()
                            .bg(theme::mix(theme::foreground(), 3.))
                            .with_animation(
                                "attachment-shimmer",
                                Animation::new(Duration::from_millis(1200)).repeat(),
                                |el, delta| el.opacity(0.4 + 0.6 * (1. - (2. * delta - 1.).abs())),
                            ),
                    ),
                }
            } else {
                let letters = extension(&file.name);
                picture_room()
                    .child(theme::hi("attachment-01").size(px(20.)).text_color(theme::muted()))
                    .when(!letters.is_empty(), |el| {
                        el.child(
                            div()
                                .text_size(px(10.5))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme::muted())
                                .child(letters),
                        )
                    })
            };
            let (open, save, remove) = (file.clone(), file.clone(), file.id.clone());
            tiles = tiles.child(
                tile(SharedString::from(format!("attachment-{}", file.id)))
                    .group(group.clone())
                    .cursor_pointer()
                    .hover(|el| el.border_color(theme::mix(theme::foreground(), 22.)))
                    .tooltip(ui::tip(file.name.clone()))
                    .on_click(cx.listener(move |this, _, window, cx| this.open_attachment(&open, window, cx)))
                    .child(room)
                    .child(
                        meta()
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(12.5))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(file.name.clone()),
                            )
                            .child(
                                div()
                                    .text_size(px(12.))
                                    .text_color(theme::muted())
                                    .child(kit::format_bytes(file.size)),
                            ),
                    )
                    .child(
                        // `.attachment-tile-actions`: only while the tile is pointed at.
                        div()
                            .absolute()
                            .top(px(6.))
                            .right(px(6.))
                            .flex()
                            .gap(px(4.))
                            .invisible()
                            .group_hover(group, |el| el.visible())
                            .child(
                                action(SharedString::from(format!("attachment-download-{}", file.id)), "download-04")
                                    .tooltip(ui::tip(t(
                                        format!("Download {}", file.name),
                                        format!("{} downloaden", file.name),
                                    )))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        // Not the tile's own click as well.
                                        cx.stop_propagation();
                                        this.download_attachment(save.id.clone(), save.name.clone(), window, cx)
                                    })),
                            )
                            .when(!read_only, |el| {
                                el.child(
                                    action(SharedString::from(format!("attachment-remove-{}", file.id)), "delete-02")
                                        .tooltip(ui::tip(t(
                                            format!("Remove {}", file.name),
                                            format!("{} verwijderen", file.name),
                                        )))
                                        .on_click(cx.listener(move |this, _, window, cx| {
                                            cx.stop_propagation();
                                            this.run(Command::DeleteAttachment { id: remove.clone() }, window, cx)
                                        })),
                                )
                            }),
                    ),
            );
        }
        // `.attachment-tile.is-uploading`.
        for (index, name) in uploads.iter().enumerate() {
            tiles = tiles.child(
                tile(SharedString::from(format!("upload-{index}")))
                    .child(picture_room().child(
                        theme::hi("attachment-01").size(px(20.)).text_color(theme::muted()).with_animation(
                            "attachment-pulse",
                            Animation::new(Duration::from_millis(2000)).repeat(),
                            |el, delta| el.opacity(0.5 + 0.5 * (1. - (2. * delta - 1.).abs())),
                        ),
                    ))
                    .child(
                        meta().child(
                            div()
                                .truncate()
                                .text_size(px(12.5))
                                .text_color(theme::muted())
                                .child(t(format!("Uploading {name}…"), format!("{name} uploaden…"))),
                        ),
                    ),
            );
        }
        tiles
    }

    /// `.issue-dropzone`: over the issue while files are dragged above it.
    pub(super) fn render_dropzone() -> Div {
        div()
            .absolute()
            .inset(px(8.))
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(8.))
            .rounded(theme::RADIUS_XL)
            .border_2()
            .border_dashed()
            .border_color(theme::primary_mark())
            .bg(theme::with_alpha(theme::background(), 0.88))
            .text_size(px(14.))
            .font_weight(FontWeight::MEDIUM)
            .child(theme::hi("attachment-01").size(px(20.)).text_color(theme::foreground()))
            .child(t("Drop files to attach them", "Laat los om bestanden toe te voegen"))
    }

    /// image-viewer.tsx: the picture fills the window, its name and the
    /// buttons on a dark bar above it.
    pub(super) fn render_image_viewer(&self, issue: &Todo, viewing: &str, window: &Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let images: Vec<&api::Attachment> = issue.attachments.iter().filter(|file| is_image(&file.content_type)).collect();
        let index = images.iter().position(|image| image.id == viewing).unwrap_or(0);
        let image = *images.get(index)?;
        let white = |alpha: f32| theme::with_alpha(rgb(0xffffff), alpha);
        let bar_button = |id: &'static str, icon: &'static str| {
            div()
                .id(id)
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(28.))
                .rounded(theme::RADIUS_MD)
                .cursor_pointer()
                .hover(|el| el.bg(white(0.1)))
                .child(theme::hi(icon).text_color(white(0.8)))
        };
        let close = cx.listener(|this, _: &ClickEvent, _, cx| {
            if let Some(view) = &mut this.issue {
                view.viewing = None;
                cx.notify();
            }
        });
        let save = image.clone();
        let bar = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(12.))
            .min_h(px(52.))
            .pl(px(20.))
            .pr(px(12.))
            .py(px(8.))
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(13.5))
                    .font_weight(FontWeight::MEDIUM)
                    .child(image.name.clone()),
            )
            .when(images.len() > 1, |el| {
                el.child(div().flex_none().text_size(px(12.)).text_color(white(0.6)).child(t(
                    format!("{} of {}", index + 1, images.len()),
                    format!("{} van {}", index + 1, images.len()),
                )))
            })
            .child(
                div()
                    .ml_auto()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(4.))
                    .child(
                        bar_button("viewer-download", "download-04")
                            .tooltip(ui::tip(t(
                                format!("Download {}", image.name),
                                format!("{} downloaden", image.name),
                            )))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.download_attachment(save.id.clone(), save.name.clone(), window, cx)
                            })),
                    )
                    .child(
                        bar_button("viewer-close", "cancel-01")
                            .tooltip(ui::tip(t("Close", "Sluiten")))
                            .on_click(close),
                    ),
            );
        let shown: AnyElement = match preview(&image.id) {
            Some(Preview::Ready(picture)) => img(picture)
                .id("viewer-image")
                .size_full()
                // `max-width: 100%; max-height: 100%; object-fit: contain`: never larger than it is.
                .object_fit(ObjectFit::ScaleDown)
                // A click on the picture is not one beside it.
                .on_click(|_, _, cx| cx.stop_propagation())
                .into_any_element(),
            Some(Preview::Failed) => div()
                .text_size(px(13.5))
                .text_color(white(0.7))
                .child(t(
                    "This image couldn't be loaded.",
                    "Deze afbeelding kon niet worden geladen.",
                ))
                .into_any_element(),
            _ => kit::spinning("loading-03").into_any_element(),
        };
        let step = |id: &'static str, icon: &'static str, label: &'static str, by: isize, cx: &mut Context<Self>| {
            div()
                .id(id)
                .absolute()
                .top_1_2()
                .mt(px(-20.))
                .flex()
                .items_center()
                .justify_center()
                .size(px(40.))
                .rounded_full()
                .bg(white(0.08))
                .hover(|el| el.bg(white(0.18)))
                .cursor_pointer()
                .child(theme::hi(icon).size(px(20.)).text_color(rgb(0xffffff)))
                .tooltip(ui::tip(label))
                .on_click(cx.listener(move |this, _, _, cx| {
                    cx.stop_propagation();
                    this.step_viewer(by, cx)
                }))
        };
        // Clicking beside the image closes, like most viewers.
        let stage = div()
            .id("viewer-stage")
            .relative()
            .flex()
            .flex_1()
            .min_h_0()
            .items_center()
            .justify_center()
            .px(px(72.))
            .pb(px(32.))
            .on_click(cx.listener(|this, _, _, cx| {
                if let Some(view) = &mut this.issue {
                    view.viewing = None;
                    cx.notify();
                }
            }))
            .child(shown)
            .when(images.len() > 1, |el| {
                el.child(
                    step(
                        "viewer-previous",
                        "arrow-left-01",
                        t("Previous image", "Vorige afbeelding"),
                        -1,
                        cx,
                    )
                    .left(px(16.)),
                )
                .child(step("viewer-next", "arrow-right-01", t("Next image", "Volgende afbeelding"), 1, cx).right(px(16.)))
            });
        let size = window.viewport_size();
        Some(
            deferred(
                anchored().position(point(px(0.), px(0.))).child(
                    div()
                        .id("image-viewer")
                        .occlude()
                        .flex()
                        .flex_col()
                        .w(size.width)
                        .h(size.height)
                        // `oklch(0.14 0 0 / 0.96)`.
                        .bg(rgba(0x090909f5))
                        .font_family(theme::FONT)
                        .text_color(rgb(0xffffff))
                        .child(bar)
                        .child(stage),
                ),
            )
            .with_priority(12)
            .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{extension, grid, is_image, pasted_name};

    #[test]
    fn pictures_are_told_by_their_type() {
        for kind in ["image/png", "image/jpeg", "image/JPG", "image/gif", "image/webp", "image/avif", "image/bmp", "image/svg+xml"] {
            assert!(is_image(kind), "{kind}");
        }
        for kind in ["image/tiff", "application/pdf", "", "image/png; charset=binary", "ximage/png"] {
            assert!(!is_image(kind), "{kind}");
        }
    }

    #[test]
    fn a_tile_names_the_file_type() {
        assert_eq!(extension("Offerte.pdf"), "PDF");
        assert_eq!(extension("a.b.markdown"), "MARKD");
        assert_eq!(extension("notities"), "");
    }

    #[test]
    fn tiles_fill_the_row_as_the_web_grid_does() {
        // 700 wide: four tiles of 148 and three gaps fit (622), five do not (780).
        let (columns, width) = grid(700.);
        assert_eq!(columns, 4);
        assert!((width - 167.5).abs() < 0.01);
        assert_eq!(grid(148.).0, 1);
        assert_eq!(grid(100.), (1, 100.));
        assert_eq!(grid(306.).0, 2);
    }

    #[test]
    fn a_pasted_picture_is_named_after_the_moment() {
        use chrono::TimeZone as _;
        let when = chrono::Local.with_ymd_and_hms(2026, 11, 13, 9, 5, 7).unwrap();
        let one = pasted_name(when, 0, 1, "png");
        assert!(one.ends_with("2026-11-13 09.05.07.png"), "{one}");
        let second = pasted_name(when, 1, 2, "png");
        assert!(second.ends_with("2026-11-13 09.05.07 (2).png"), "{second}");
    }
}
