'use strict';

define('admin/plugins/reactions', [
	'settings',  'alerts', 'hooks', 'emoji-dialog', 'emoji',
], function (Settings, alerts, hooks, emojiDialog, emoji) {
	var ACP = {};
	ACP.init = function () {
		emoji.init(function () {
			Settings.load('reactions', $('.reactions-settings'), onSettingsLoaded);
		});
	};

	function onSettingsLoaded() {
		hooks.on('action:settings.sorted-list.parse', function (data) {
			const reactionEl = data.itemHtml.find('[data-reaction]');
			if (reactionEl.length) {
				const reaction = reactionEl.attr('data-reaction');
				if (reaction) {
					const foundEmoji = emoji.table[reaction]
					if (foundEmoji) {
						reactionEl.html(emoji.buildEmoji(foundEmoji));
					}
				}
			}
		});

		hooks.on('action:settings.sorted-list.modal', function (data) {
			const { modal } = data;
			modal.removeAttr('tabindex');
			modal.find('#reaction').off('click').on('click', function () {
				emojiDialog.toggle(modal.find('#reaction')[0], function (_, name, dialog) {
					emojiDialog.dialogActions.close(dialog);
					modal.find('#reaction').val(name);
				});
			});
			modal.off('hide.bs.modal').on('hide.bs.modal', function () {
				emojiDialog.dialogActions.close($('#emoji-dialog'));
			});
		});

		$('#save').on('click', function () {
			Settings.save('reactions', $('.reactions-settings'), function () {
				alerts.alert({
					type: 'success',
					alert_id: 'reactions-saved',
					title: 'Settings Saved',
					message: 'Reactions plugin settings saved',
					timeout: 3000
				});
			});
		});
	}

	return ACP;
});
