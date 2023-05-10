<form role="form" class="reactions-settings">
	<div class="row">
		<div class="col-sm-2 col-xs-12 settings-header">[[reactions:settings.title]]</div>
		<div class="col-sm-10 col-xs-12">
			<div class="form-group">
				<label>[[reactions:settings.max-reactions-per-post]]</label>
				<input type="text" class="form-control" id="maximumReactions" name="maximumReactions">
			</div>
		</div>
	</div>
	<div class="row">
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





<div class="floating-button">
	<button id="save" class="btn btn-primary position-fixed bottom-0 end-0 px-3 py-2 mb-4 me-4 rounded-circle fs-4" type="button" style="width: 64px; height: 64px;">
		<i class="fa fa-fw fas fa-floppy-disk"></i>
	</button>
</div>