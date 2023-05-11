<form role="form" class="reactions-settings">
	<div class="row">
		<div class="col-sm-2 col-xs-12 settings-header">[[reactions:settings.title]]</div>
		<div class="col-sm-10 col-xs-12">
			<div class="form-group">
				<label>[[reactions:settings.max-reactions-per-post]]</label>
				<input type="number" min="0" class="form-control" id="maximumReactions" name="maximumReactions">

				<label>[[reactions:settings.max-reactions-per-user-per-post]]</label>
				<input type="number" min="0" class="form-control" id="maximumReactionsPerUserPerPost" name="maximumReactionsPerUserPerPost">
				<p class="help-text">
					[[reactions:settings.max-reactions-per-user-per-post-help]]
				</p>
			</div>
		</div>
	</div>

	<div class="row mt-3">
		<div class="col-sm-2 col-xs-12 settings-header">[[reactions:settings.reaction-reputations]]</div>
		<div class="col-sm-10 col-xs-12">
			<p class="help-text">
				[[reactions:settings.reaction-reputations-help]]
			</p>
			<div class="form-group" data-type="sorted-list" data-sorted-list="reaction-reputations" data-item-template="admin/plugins/reactions/partials/sorted-list/emoji-item" data-form-template="admin/plugins/reactions/partials/sorted-list/emoji-form">
				<ul data-type="list" class="list-group"></ul>
				<button type="button" data-type="add" class="btn btn-info mt-2">[[reactions:settings.reaction-reputations.add]]</button>
			</div>
		</div>
	</div>
</form>


<!-- IMPORT admin/partials/save_button.tpl -->