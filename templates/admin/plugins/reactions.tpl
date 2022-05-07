<form role="form" class="reactions-settings">
	<div class="row">
		<div class="col-sm-2 col-xs-12 settings-header">Reactions plugin settings</div>
		<div class="col-sm-10 col-xs-12">
			<div class="form-group">
				<label>Maximum unique reactions per post</label>
				<input type="text" class="form-control" id="maximumReactions" name="maximumReactions">
			</div>
		</div>
	</div>
	<div class="row">
		<div class="col-sm-2 col-xs-12 settings-header">Reaction Reputations (Optional)</div>
		<div class="col-sm-10 col-xs-12">
			<p class="help-text">
				You can assign a reputation to individual reactions. When a reaction is applied to a post, the owner of that post will get this reputation.
			</p>
			<div class="form-group" data-type="sorted-list" data-sorted-list="reaction-reputations" data-item-template="admin/plugins/reactions/partials/sorted-list/emoji-item" data-form-template="admin/plugins/reactions/partials/sorted-list/emoji-form">
				<ul data-type="list" class="list-group"></ul>
				<button type="button" data-type="add" class="btn btn-info">Add Item</button>
			</div>
		</div>
	</div>
</form>





<button id="save" class="floating-button mdl-button mdl-js-button mdl-button--fab mdl-js-ripple-effect mdl-button--colored">
    <i class="material-icons">save</i>
</button>
