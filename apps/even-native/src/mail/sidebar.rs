//! The folders and the mailboxes.

use crate::api::Folder;
use crate::theme;

use super::*;

impl MailView {
    pub(super) fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let folders = Folder::ALL.into_iter().map(|folder| {
            let active = folder == self.folder;
            div()
                .id(SharedString::from(format!("folder-{folder:?}")))
                .flex()
                .items_center()
                .h(px(30.))
                .px_2p5()
                .rounded_md()
                .text_sm()
                .when(active, |el| el.bg(theme::accent()).text_color(theme::foreground()))
                .when(!active, |el| {
                    el.text_color(theme::muted()).hover(|el| el.bg(theme::hover()))
                })
                .child(folder_name(folder))
                .on_click(cx.listener(move |this, _, _, cx| this.show_folder(folder, cx)))
        });
        let accounts = self.accounts.iter().map(|account| {
            div()
                .flex()
                .items_center()
                .gap_2()
                .text_xs()
                .text_color(theme::muted())
                .child(div().size(px(7.)).rounded_full().bg(theme::account(account.color)))
                .child(div().truncate().child(account.email.clone()))
        });
        div()
            .flex()
            .flex_col()
            .w(px(220.))
            .flex_none()
            .h_full()
            .bg(theme::sidebar())
            .border_r_1()
            .border_color(theme::border())
            .child(div().h(px(TITLE_BAR)).flex_none())
            .child(
                div()
                    .px_4()
                    .pb_3()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Even mailen"),
            )
            .child(div().flex().flex_col().gap_0p5().px_2().children(folders))
            .child(div().flex_1())
            .child(div().flex().flex_col().gap_1p5().p_4().children(accounts))
    }
}

pub(super) fn folder_name(folder: Folder) -> &'static str {
    match folder {
        Folder::Inbox => "Inbox",
        Folder::Starred => "Met ster",
        Folder::Sent => "Verzonden",
        Folder::Archive => "Archief",
        Folder::Spam => "Spam",
        Folder::Trash => "Prullenbak",
    }
}
