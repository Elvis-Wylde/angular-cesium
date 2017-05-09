import { ChangeDetectorRef, Component, Input, OnInit, ViewChild, NgZone } from '@angular/core';
import { ConnectableObservable, Observable, Subject } from 'rxjs';
import { AcNotification } from '../../../../src/models/ac-notification';
import { ActionType } from '../../../../src/models/action-type.enum';
import { AcLayerComponent } from '../../../../src/components/ac-layer/ac-layer.component';
import { MapEventsManagerService } from '../../../../src/services/map-events-mananger/map-events-manager';
import { CesiumEvent } from '../../../../src/services/map-events-mananger/consts/cesium-event.enum';
import { PickOptions } from '../../../../src/services/map-events-mananger/consts/pickOptions.enum';
import { AcEntity } from '../../../../src/models/ac-entity';
import { MdDialog } from '@angular/material';
import { TracksDialogComponent } from './track-dialog/track-dialog.component';
import { WebSocketSupplier } from '../../../utils/services/webSocketSupplier/webSocketSupplier';

@Component({
	selector: 'tracks-layer',
	templateUrl: './tracks-layer.component.html',
	styleUrls: ['./tracks-layer.component.css']
})
export class TracksLayerComponent implements OnInit {
	@ViewChild(AcLayerComponent) layer: AcLayerComponent;

	@Input()
	show: boolean;

	tracks$: ConnectableObservable<AcNotification>;
	Cesium = Cesium;
	private lastPickTrack;
	private tracks = new Map<number, any>();

	constructor(private mapEventsManager: MapEventsManagerService, public dialog: MdDialog, private webSocketSupllier: WebSocketSupplier,
							private cd: ChangeDetectorRef, private ngZone: NgZone) {
	}

	ngOnInit() {
		const socket = this.webSocketSupllier.get();
		this.tracks$ = Observable.create((observer) => {
			socket.on('birds', (data) => {
				data.forEach(
					(acNotification) => {
						if (acNotification.action === 'ADD_OR_UPDATE') {
							acNotification.actionType = ActionType.ADD_UPDATE;
							acNotification.entity = AcEntity.create(this.convertToCesiumObj(acNotification.entity));
							const entity = acNotification.entity;
							const track = this.tracks.get(acNotification.id);
							if (!this.tracks.has(acNotification.id)) {
								this.tracks.set(acNotification.id, entity);
							}
							else {
								Object.assign(track, entity);
								acNotification.entity = track;
							}
						}
						else if (acNotification.action === 'DELETE') {
							acNotification.actionType = ActionType.DELETE;
							const id = acNotification.id;
							this.tracks.delete(id);
						}
						observer.next(acNotification);
					});
			});
		}).publish();

		this.tracks$.connect();

		const mouseOverObservable = this.mapEventsManager.register({
			event: CesiumEvent.MOUSE_MOVE,
			pick: PickOptions.PICK_FIRST,
			priority: 2,
		});

		mouseOverObservable.subscribe((event) => {
			const track = event.entities !== null ? event.entities[0] : null;
			if (this.lastPickTrack && (!track || track.id !== this.lastPickTrack.id)) {
				this.lastPickTrack.picked = false;
				this.layer.update(this.lastPickTrack, this.lastPickTrack.id);
			}
			if (track && (!this.lastPickTrack || track.id !== this.lastPickTrack.id)) {
				track.picked = true;
				this.layer.update(track, track.id);
			}
			this.lastPickTrack = track;
		});

		const doubleClickObservable = this.mapEventsManager.register({
			event: CesiumEvent.LEFT_DOUBLE_CLICK,
			pick: PickOptions.PICK_FIRST,
			priority: 2,
		});

		doubleClickObservable.subscribe((event) => {
			const track = event.entities !== null ? event.entities[0] : null;
			if (track) {
				this.ngZone.run(() => this.openDialog(track));
			}
		});
	}

	openDialog(track) {
		track.dialogOpen = true;
		this.layer.update(track, track.id);
		this.dialog.closeAll();
		const end$ = new Subject();
		const trackObservable = this.getSingleTrackObservable(track.id, end$);
		const dialogUpdateStream = new Subject<AcNotification>();
		trackObservable.merge(dialogUpdateStream);
		this.ngZone.run(() => dialogUpdateStream.next(track));
		this.dialog.open(TracksDialogComponent, {
			data: { trackObservable },
			position: {
				top: '10px',
				left: '10px',
			},
			width: '300px',
			height: '300px',
		}).afterClosed().subscribe(() => {
			end$.next(0);
			track.dialogOpen = false;
			this.layer.update(track, track.id);
		});
	}

	getSingleTrackObservable(trackId, end$) {
		return this.tracks$
			.filter((notification) => notification.id === trackId).map((notification) => notification.entity).takeUntil(end$);
	}

	getTrackColor(track): any {
		if (track.dialogOpen) {
			return Cesium.Color.GREENYELLOW;
		}
		if (track.picked) {
			return Cesium.Color.YELLOW;
		}
		else {
			return track.isTarget ? Cesium.Color.RED : Cesium.Color.BLUE;
		}
	}

	getTextColor(track): any {
		return Cesium.Color.BLACK;
	}

	getPolylineColor() {
		return new Cesium.Material({
			fabric: {
				type: 'Color',
				uniforms: {
					color: new Cesium.Color(0.6, 1.0, 0.6, 1.0)
				}
			}
		});
	}

	convertToCesiumObj(entity): any {
		entity.scale = entity.id === 1 ? 0.3 : 0.15;
		entity.altitude = Math.round(entity.position.altitude);
		entity.position = Cesium.Cartesian3.fromDegrees(entity.position.long, entity.position.lat, entity.position.altitude);
		entity.futurePosition =
			Cesium.Cartesian3.fromDegrees(entity.futurePosition.long, entity.futurePosition.lat, entity.futurePosition.altitude);
		return entity;
	}

	removeAll() {
		this.layer.removeAll();
	}

	setShow($event) {
		this.show = $event;
	}
}