'use strict';
/* globals $, app */

define('admin/plugins/reactions', ['settings'], function(Settings) {

	var ACP = {};

	ACP.init = function() {
		Settings.load('reactions', $('.reactions-settings'));

		$('#save').on('click', function() {
			Settings.save('reactions', $('.reactions-settings'), function() {
				app.alert({
					type: 'success',
					alert_id: 'reactions-saved',
					title: 'Settings Saved',
					message: 'Reactions plugin settings saved'
				});
			});
		});
	};

	return ACP;
});
