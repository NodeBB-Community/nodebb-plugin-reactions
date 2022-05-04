'use strict';

define('admin/plugins/reactions', ['settings',  'alerts'], function (Settings, alerts) {
	var ACP = {};
	ACP.init = function () {
		Settings.load('reactions', $('.reactions-settings'));

		$('#save').on('click', function () {
			Settings.save('reactions', $('.reactions-settings'), function () {
				alerts.alert({
					type: 'success',
					alert_id: 'reactions-saved',
					title: 'Settings Saved',
					message: 'Reactions plugin settings saved',
				});
			});
		});
	};

	return ACP;
});
