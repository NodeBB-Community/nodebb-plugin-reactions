
<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 col-md-8 px-0 mb-4" tabindex="0">
			<form role="form" class="reactions-settings">
				<div class="mb-3">
					<h5 class="fw-bold tracking-tight settings-header">[[reactions:settings.title]]</h5>
					<div class="mb-3">
						<label class="form-label">[[reactions:settings.max-reactions-per-post]]</label>
						<input type="number" min="0" class="form-control" id="maximumReactions" name="maximumReactions">

					</div>
					<div class="mb-3">
						<label class="form-label">[[reactions:settings.max-reactions-per-user-per-post]]</label>
						<input type="number" min="0" class="form-control" id="maximumReactionsPerUserPerPost" name="maximumReactionsPerUserPerPost">
						<p class="form-text">
							[[reactions:settings.max-reactions-per-user-per-post-help]]
						</p>
					</div>
					<div class="mb-3">
						<label class="form-label">[[reactions:settings.max-reactions-per-message]]</label>
						<input type="number" min="0" class="form-control" id="maximumReactionsPerMessage" name="maximumReactionsPerMessage">

					</div>
					<div class="">
						<label class="form-label">[[reactions:settings.max-reactions-per-user-per-message]]</label>
						<input type="number" min="0" class="form-control" id="maximumReactionsPerUserPerMessage" name="maximumReactionsPerUserPerMessage">
						<p class="form-text">
							[[reactions:settings.max-reactions-per-user-per-message-help]]
						</p>
					</div>
				</div>

				<div class="mb-3">
					<h5 class="fw-bold tracking-tight settings-header">[[reactions:settings.reaction-reputations]]</h5>

					<p class="form-text">
						[[reactions:settings.reaction-reputations-help]]
					</p>
					<div class="form-group" data-type="sorted-list" data-sorted-list="reaction-reputations" data-item-template="admin/plugins/reactions/partials/sorted-list/emoji-item" data-form-template="admin/plugins/reactions/partials/sorted-list/emoji-form">
						<ul data-type="list" class="list-group"></ul>
						<button type="button" data-type="add" class="btn btn-info mt-2">[[reactions:settings.reaction-reputations.add]]</button>
					</div>
				</div>
			</form>
		</div>

		<!-- IMPORT admin/partials/settings/toc.tpl -->
	</div>
</div>
